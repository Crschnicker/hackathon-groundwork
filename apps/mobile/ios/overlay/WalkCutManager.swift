import Foundation
import Combine
import UIKit

/// Records a site walk as a series of short recordings instead of one long one, so each part
/// can be transcribed while the walk is still going.
///
/// Every `cutSeconds` it stops the device's recording and starts a new one straight away. The
/// starter app already syncs the device after every stop; each file that lands is sent to the
/// Groundwork API, which transcribes it and updates the site model.
final class WalkCutManager {

    static let shared = WalkCutManager()

    enum Phase: Equatable {
        case idle
        /// Walk created, waiting for the device to confirm the first recording.
        case starting
        case recording
        /// Stop sent for a cut; the next recording starts when the device confirms.
        case cutting
        /// Recording is over; chunks are still syncing or uploading.
        case finishing
    }

    enum ChunkStage: Equatable {
        case recording
        case waitingForSync
        case uploading
        case sent
        case failed(String)
    }

    struct Chunk {
        let sessionId: Int
        var stage: ChunkStage
        /// Time with no recording running before this chunk began, measured on the phone.
        var gapMs: Int?
        var bytes: Int?
        var closedAt: Date?
        var sentAt: Date?
        var uploadAttempts = 0
    }

    struct Snapshot {
        var phase: Phase = .idle
        var walkId: String?
        var cutSeconds = WalkSettings.defaultCutSeconds
        var chunks: [Chunk] = []
        var nextCutAt: Date?
        var message: String?
    }

    // MARK: - Published state

    var snapshotPublisher: AnyPublisher<Snapshot, Never> { snapshotSubject.eraseToAnyPublisher() }
    var logPublisher: AnyPublisher<String, Never> { logSubject.eraseToAnyPublisher() }
    var snapshot: Snapshot { snapshotSubject.value }

    private let snapshotSubject = CurrentValueSubject<Snapshot, Never>(Snapshot())
    private let logSubject = PassthroughSubject<String, Never>()

    // MARK: - Private state (main queue only)

    private static let deviceAckTimeout: TimeInterval = 6
    private static let maxUploadAttempts = 4
    private static let syncKickInterval: TimeInterval = 5

    private var state = Snapshot() { didSet { snapshotSubject.send(state) } }
    private var cancellables = Set<AnyCancellable>()
    private var cutTimer: DispatchWorkItem?
    private var ackWatchdog: DispatchWorkItem?
    private var syncKick: DispatchWorkItem?
    private var lastStopAt: Date?
    private var ackRetried = false
    private var finishSent = false
    private var syncIsActive = false

    private init() {
        RecordingManager.shared.stateSubject
            .receive(on: DispatchQueue.main)
            .sink { [weak self] in self?.recorderChanged($0) }
            .store(in: &cancellables)

        SyncManager.shared.filesPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] in self?.filesChanged($0) }
            .store(in: &cancellables)

        SyncManager.shared.statePublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] syncState in
                self?.syncIsActive = syncState.isActive
                if case .failed(let reason) = syncState { self?.log("Sync failed: \(reason)") }
                self?.scheduleSyncKick()
            }
            .store(in: &cancellables)
    }

    /// The session the device is recording right now, which must not be synced or deleted.
    var sessionInProgress: Int? {
        RecordingManager.shared.stateSubject.value.currentSessionId
    }

    // MARK: - Control

    func startWalk() {
        guard state.phase == .idle else { return }
        guard case .connected = DeviceManager.shared.currentConnectionState else {
            return fail("Connect the Plaud device first.")
        }
        guard !RecordingManager.shared.stateSubject.value.isActive else {
            return fail("The device is already recording. Stop that recording, then start the walk.")
        }

        let cutSeconds = WalkSettings.cutSeconds
        var userId = JwtUtils.parse(DeviceManager.shared.userAccessToken)?.userId ?? RecordingStore.shared.userId ?? ""
        if userId.count < 6 { userId = "recorder-" + userId }

        state = Snapshot(phase: .starting, walkId: nil, cutSeconds: cutSeconds, chunks: [], nextCutAt: nil, message: "Creating the walk…")
        lastStopAt = nil
        finishSent = false
        UIApplication.shared.isIdleTimerDisabled = true

        WalkBackend.shared.createWalk(userId: userId, cutSeconds: cutSeconds) { [weak self] result in
            guard let self = self, self.state.phase == .starting else { return }
            switch result {
            case .failure(let error):
                self.reset()
                self.fail("Could not reach the Groundwork API: \(error.localizedDescription)")
            case .success(let walkId):
                self.state.walkId = walkId
                self.state.message = "Starting the recording…"
                self.log("Walk \(walkId) created, cutting every \(cutSeconds)s")
                self.sendStart()
            }
        }
    }

    func stopWalk() {
        switch state.phase {
        case .idle, .finishing:
            return
        case .starting:
            // Nothing recorded yet; if the device did start, stop it.
            cancelTimers()
            if RecordingManager.shared.stateSubject.value.isActive { RecordingManager.shared.stopRecord() }
            beginFinishing("Walk stopped before anything was recorded.")
        case .recording, .cutting:
            cancelTimers()
            log("Stopping the walk")
            state.phase = .finishing
            state.nextCutAt = nil
            state.message = "Stopping the recording…"
            if RecordingManager.shared.stateSubject.value.isActive {
                RecordingManager.shared.stopRecord()
            } else {
                finishIfComplete()
            }
        }
    }

    // MARK: - Recorder events

    private func recorderChanged(_ recorder: RecordingState) {
        switch (state.phase, recorder) {

        case (.starting, .recording(let sessionId, _)), (.cutting, .recording(let sessionId, _)):
            guard state.walkId != nil else { return }
            ackWatchdog?.cancel()
            let gapMs = lastStopAt.map { Int(Date().timeIntervalSince($0) * 1000) }
            if !state.chunks.contains(where: { $0.sessionId == sessionId }) {
                state.chunks.append(Chunk(sessionId: sessionId, stage: .recording, gapMs: gapMs))
            }
            state.phase = .recording
            state.message = nil
            if let gapMs = gapMs { log("Recording \(sessionId) started, \(gapMs) ms after the last one stopped") }
            else { log("Recording \(sessionId) started") }
            scheduleCut()

        case (.cutting, .idle):
            // The stop we asked for. Start the next recording before doing anything else.
            ackWatchdog?.cancel()
            closeRecordingChunk()
            sendStart()

        case (.recording, .idle):
            // Stopped by the device button or from another screen: that ends the walk.
            cancelTimers()
            closeRecordingChunk()
            log("The recording was stopped outside the walk; finishing")
            beginFinishing("Recording stopped on the device. Finishing the walk…")

        case (.finishing, .idle):
            closeRecordingChunk()
            finishIfComplete()

        default:
            break
        }
    }

    private func closeRecordingChunk() {
        guard let index = state.chunks.firstIndex(where: { $0.stage == .recording }) else { return }
        lastStopAt = Date()
        state.chunks[index].stage = .waitingForSync
        state.chunks[index].closedAt = lastStopAt
        log("Recording \(state.chunks[index].sessionId) closed")
        scheduleSyncKick()
    }

    // MARK: - Cutting

    private func scheduleCut() {
        cutTimer?.cancel()
        let seconds = TimeInterval(state.cutSeconds)
        state.nextCutAt = Date().addingTimeInterval(seconds)
        let work = DispatchWorkItem { [weak self] in self?.cut() }
        cutTimer = work
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: work)
    }

    private func cut() {
        guard state.phase == .recording else { return }
        state.phase = .cutting
        state.nextCutAt = nil
        ackRetried = false
        log("Cut: stopping the recording")
        RecordingManager.shared.stopRecord()
        watchForAck { [weak self] in
            guard let self = self, self.state.phase == .cutting else { return }
            if RecordingManager.shared.stateSubject.value.isActive, !self.ackRetried {
                self.ackRetried = true
                self.log("No answer to the stop; sending it again")
                RecordingManager.shared.stopRecord()
                self.watchForAck { [weak self] in self?.abandonCut() }
            } else {
                self.abandonCut()
            }
        }
    }

    /// The device never confirmed the stop, so it is presumably still recording. Keep the
    /// audio safe in one longer chunk and try again at the next interval.
    private func abandonCut() {
        guard state.phase == .cutting else { return }
        if RecordingManager.shared.stateSubject.value.isActive {
            log("The device did not confirm the cut; this chunk will run long")
            state.phase = .recording
            scheduleCut()
        } else {
            closeRecordingChunk()
            sendStart()
        }
    }

    private func sendStart() {
        ackRetried = false
        RecordingManager.shared.startRecord()
        watchForAck { [weak self] in
            guard let self = self, self.state.phase == .starting || self.state.phase == .cutting else { return }
            if !self.ackRetried {
                self.ackRetried = true
                self.log("No answer to the start; sending it again")
                RecordingManager.shared.startRecord()
                self.watchForAck { [weak self] in self?.startFailed() }
            } else {
                self.startFailed()
            }
        }
    }

    private func startFailed() {
        guard state.phase == .starting || state.phase == .cutting else { return }
        log("The device did not start recording")
        beginFinishing("The device did not start recording. The walk has ended; what was recorded is still being processed.")
    }

    private func watchForAck(_ onTimeout: @escaping () -> Void) {
        ackWatchdog?.cancel()
        let work = DispatchWorkItem(block: onTimeout)
        ackWatchdog = work
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.deviceAckTimeout, execute: work)
    }

    private func cancelTimers() {
        cutTimer?.cancel()
        ackWatchdog?.cancel()
        cutTimer = nil
        ackWatchdog = nil
    }

    // MARK: - Sync and upload

    /// The starter app syncs once after each stop and ignores the request if a sync is already
    /// running, so a chunk closed during a sync would wait for the next stop. Ask again.
    private func scheduleSyncKick() {
        syncKick?.cancel()
        guard state.walkId != nil, state.chunks.contains(where: { $0.stage == .waitingForSync }) else { return }
        let work = DispatchWorkItem { [weak self] in
            guard let self = self else { return }
            if !self.syncIsActive, self.state.chunks.contains(where: { $0.stage == .waitingForSync }) {
                SyncManager.shared.startSync()
            }
            self.scheduleSyncKick()
        }
        syncKick = work
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.syncKickInterval, execute: work)
    }

    private func filesChanged(_ files: [RecordingFile]) {
        guard state.walkId != nil else { return }
        for file in files where file.isSynced {
            guard let index = state.chunks.firstIndex(where: { $0.sessionId == file.sessionId }),
                  state.chunks[index].stage == .waitingForSync,
                  let path = RecordingStore.shared.resolveAbsolutePath(for: file) else { continue }
            upload(sessionId: file.sessionId, path: path)
        }
    }

    private func upload(sessionId: Int, path: String) {
        guard let walkId = state.walkId,
              let index = state.chunks.firstIndex(where: { $0.sessionId == sessionId }) else { return }
        let size = (try? FileManager.default.attributesOfItem(atPath: path)[.size] as? Int) ?? 0
        state.chunks[index].stage = .uploading
        state.chunks[index].bytes = size
        state.chunks[index].uploadAttempts += 1
        let attempt = state.chunks[index].uploadAttempts
        var waited = ""
        if let closedAt = state.chunks[index].closedAt {
            waited = ", \(Int(Date().timeIntervalSince(closedAt)))s after it closed"
        }
        log("Recording \(sessionId) synced (\(size / 1024) KB\(waited)); uploading")

        WalkBackend.shared.sendChunk(
            walkId: walkId,
            sessionId: sessionId,
            gapMs: state.chunks[index].gapMs,
            file: URL(fileURLWithPath: path)
        ) { [weak self] result in
            guard let self = self, self.state.walkId == walkId,
                  let index = self.state.chunks.firstIndex(where: { $0.sessionId == sessionId }) else { return }
            switch result {
            case .success:
                self.state.chunks[index].stage = .sent
                self.state.chunks[index].sentAt = Date()
                self.log("Recording \(sessionId) sent")
            case .failure(let error):
                if attempt < Self.maxUploadAttempts {
                    self.log("Upload of \(sessionId) failed (\(error.localizedDescription)); retrying")
                    DispatchQueue.main.asyncAfter(deadline: .now() + Double(attempt) * 3) { [weak self] in
                        self?.upload(sessionId: sessionId, path: path)
                    }
                    return
                }
                self.state.chunks[index].stage = .failed(error.localizedDescription)
                self.log("Upload of \(sessionId) failed for good: \(error.localizedDescription)")
            }
            self.finishIfComplete()
        }
    }

    // MARK: - Finishing

    private func beginFinishing(_ message: String) {
        cancelTimers()
        state.phase = .finishing
        state.nextCutAt = nil
        state.message = message
        finishIfComplete()
    }

    private func finishIfComplete() {
        guard state.phase == .finishing, !finishSent else { return }
        let pending = state.chunks.contains { chunk in
            switch chunk.stage {
            case .recording, .waitingForSync, .uploading: return true
            case .sent, .failed: return false
            }
        }
        guard !pending else {
            state.message = "Waiting for the last recordings to sync from the device…"
            scheduleSyncKick()
            return
        }
        guard let walkId = state.walkId else { return reset() }
        finishSent = true
        WalkBackend.shared.finishWalk(walkId: walkId) { [weak self] result in
            guard let self = self else { return }
            if case .failure(let error) = result {
                self.log("Could not mark the walk finished: \(error.localizedDescription)")
            }
            let sent = self.state.chunks.filter { $0.stage == .sent }.count
            self.log("Walk finished: \(sent) of \(self.state.chunks.count) recordings sent")
            self.state.message = "Walk finished. \(sent) of \(self.state.chunks.count) recordings sent."
            self.reset(keepingResult: true)
        }
    }

    /// Back to idle. The finished walk's id and chunks stay on show until the next one starts.
    private func reset(keepingResult: Bool = false) {
        cancelTimers()
        syncKick?.cancel()
        UIApplication.shared.isIdleTimerDisabled = false
        if keepingResult {
            state.phase = .idle
            state.nextCutAt = nil
        } else {
            state = Snapshot()
        }
    }

    private func fail(_ message: String) {
        log(message)
        state.message = message
    }

    private func log(_ message: String) {
        AppLog.log("[Walk] \(message)")
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        logSubject.send("\(formatter.string(from: Date()))  \(message)")
    }
}
