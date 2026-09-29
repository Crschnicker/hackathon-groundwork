import Foundation
import Combine
import UIKit
import PlaudDeviceBasicSDK

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
        /// Carries the reason in plain words, for the screen.
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
        /// Where the audio file is on the phone; nil until the device has handed it over.
        var audioPath: String?

        var isFailed: Bool {
            if case .failed = stage { return true }
            return false
        }

        /// Failed, and the audio is on the phone to send again.
        var canSendAgain: Bool { isFailed && audioPath != nil }
    }

    enum MessageKind {
        /// An ordinary step on the way.
        case progress
        /// Worth reading, nothing to do.
        case notice
        /// Something went wrong, or the user has to act.
        case problem
    }

    struct Message: Equatable {
        /// Goes up with every message, so the same words said twice count as two messages.
        let id: Int
        let text: String
        let kind: MessageKind
    }

    /// What has to be in place before a walk can start, in the order it is checked.
    enum Requirement {
        case recorder
        case server
        case plaudSignIn
    }

    struct Readiness {
        let recorderConnected: Bool
        /// Something is in the address field, whether or not it is a usable address.
        let serverAddressEntered: Bool
        /// The host name in the server address; nil when the address is missing or unusable.
        let serverHost: String?
        /// When the Plaud token stops working; nil when the token cannot be read.
        let plaudExpiry: Date?
        let plaudExpired: Bool
        /// What is not in place, first things first. Empty when a walk can start.
        let missing: [Requirement]
    }

    struct Snapshot {
        var phase: Phase = .idle
        var walkId: String?
        var cutSeconds = WalkSettings.defaultCutSeconds
        var chunks: [Chunk] = []
        var nextCutAt: Date?
        var message: Message?
        /// False once the device has been out of reach for a few seconds.
        var recorderConnected = false
        /// When the device confirmed the first recording of this walk.
        var startedAt: Date?
        /// When recording stopped. Kept, with `startedAt`, after the walk has finished.
        var endedAt: Date?
        /// The walk is over and its result is still on show.
        var finished = false
        /// The walk is over on the phone, but the server could not be told.
        var serverNotTold = false
        /// How many times the app has come back from the background to a cut that was overdue.
        var lateReturns = 0

        var isActive: Bool { phase != .idle }
        var notSentCount: Int { chunks.filter { $0.isFailed }.count }
        var sendAgainCount: Int { chunks.filter { $0.canSendAgain }.count }

        /// Something is left that `retryFailed()` can do.
        var canSendAgain: Bool { sendAgainCount > 0 || (finished && serverNotTold && !chunks.isEmpty) }

        /// Finished with every recording sent. False for a walk that finished with some missing.
        var finishedCleanly: Bool { finished && notSentCount == 0 && !serverNotTold }

        /// How long the walk has been recording, or how long it was once it is over.
        func elapsed(at now: Date) -> TimeInterval? {
            guard let startedAt = startedAt else { return nil }
            return max(0, (endedAt ?? now).timeIntervalSince(startedAt))
        }
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
    private static let maxFinishAttempts = 3
    private static let syncKickInterval: TimeInterval = 5
    /// How long the device has to stay out of reach before the walk says so. A reconnect
    /// passes through a moment of "not connected" that is not worth a warning.
    private static let outOfRangeDelay: TimeInterval = 3
    /// Time given to the device to finish its handshake after a reconnect.
    private static let reconnectSettle: TimeInterval = 3
    private static let connectionRecheckInterval: TimeInterval = 3
    /// How long a notice stays before the message line goes back to what is happening now.
    private static let noticeSeconds: TimeInterval = 20
    /// A cut this late was held up by the app being in the background.
    private static let lateCutSeconds: TimeInterval = 5
    private static let notSyncedReason = "not synced from the recorder; the audio is still on it"

    private var state = Snapshot() { didSet { snapshotSubject.send(state) } }
    private var cancellables = Set<AnyCancellable>()
    private var cutTimer: DispatchWorkItem?
    private var ackWatchdog: DispatchWorkItem?
    private var syncKick: DispatchWorkItem?
    private var lostCheck: DispatchWorkItem?
    private var connectionRecheck: DispatchWorkItem?
    private var noticeClear: DispatchWorkItem?
    private var lastStopAt: Date?
    private var ackRetried = false
    private var finishSent = false
    private var syncIsActive = false
    private var lastSyncEventAt = Date.distantPast
    private var connectedDevice: PlaudDevice?
    /// A start has been sent to the device and not answered yet.
    private var startInFlight = false
    /// The device went out of reach between two recordings; the next one starts when it is back.
    private var waitingToResume = false
    private var backgroundedAt: Date?
    private var lateCutWhileAway = false
    private var messageSerial = 0
    private var sendingMessageId: Int?

    private init() {
        DeviceManager.shared.connectedDevicePublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] device in
                self?.connectedDevice = device
                self?.connectionMayHaveChanged()
            }
            .store(in: &cancellables)

        DeviceManager.shared.connectionStatePublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in self?.connectionMayHaveChanged() }
            .store(in: &cancellables)

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
                self?.lastSyncEventAt = Date()
                if case .failed(let reason) = syncState { self?.log("Sync failed: \(reason)") }
                self?.scheduleSyncKick()
            }
            .store(in: &cancellables)

        // Both are posted on the main thread, and are handled at once: a hop to the next turn
        // of the queue could be put off until the app is awake again.
        NotificationCenter.default.publisher(for: UIApplication.didEnterBackgroundNotification)
            .sink { [weak self] _ in self?.enteredBackground() }
            .store(in: &cancellables)

        NotificationCenter.default.publisher(for: UIApplication.willEnterForegroundNotification)
            .sink { [weak self] _ in self?.returnedToForeground() }
            .store(in: &cancellables)

        WalkBackend.shared.onWaitingForConnection = { [weak self] in self?.uploadIsWaiting() }

        seedConnection()
    }

    /// The starter reports `.connected` only when the device answers a bind. Home shows a device
    /// as connected from `connectedDevicePublisher`, which is also set when the device reports its
    /// state, so after a reconnect the device can be in use while the state still says otherwise.
    ///
    /// This is the one rule for "is the recorder connected"; everything asks here.
    var deviceIsConnected: Bool {
        if case .connected = DeviceManager.shared.currentConnectionState { return true }
        return connectedDevice != nil || PlaudDeviceAgent.shared.isConnected()
    }

    /// The session the device is recording right now, which must not be synced or deleted.
    var sessionInProgress: Int? {
        RecordingManager.shared.stateSubject.value.currentSessionId
    }

    /// What a walk needs before it can start, and what is missing.
    var readiness: Readiness {
        let connected = deviceIsConnected
        let host = WalkSettings.apiHost
        let expiry = WalkBackend.shared.plaudTokenExpiry
        let expired = expiry.map { $0 <= Date() } ?? false
        var missing: [Requirement] = []
        if !connected { missing.append(.recorder) }
        if host == nil { missing.append(.server) }
        if expired { missing.append(.plaudSignIn) }
        return Readiness(
            recorderConnected: connected,
            serverAddressEntered: !WalkSettings.apiURL.isEmpty,
            serverHost: host,
            plaudExpiry: expiry,
            plaudExpired: expired,
            missing: missing
        )
    }

    // MARK: - Control

    func startWalk() {
        guard state.phase == .idle else { return }
        let readiness = self.readiness
        if let missing = readiness.missing.first {
            switch missing {
            case .recorder:
                log("Start refused: the recorder is not connected (the app reports it as \(DeviceManager.shared.currentConnectionState))")
                return refuse("The recorder is not connected. Connect the recorder on the Home tab.")
            case .server:
                log("Start refused: no usable server address")
                return refuse(readiness.serverAddressEntered
                    ? "The server address is not a web address. Correct it under Details."
                    : "The server address is not set. Add it under Details.")
            case .plaudSignIn:
                log("Start refused: the Plaud token has expired")
                return refuse("The Plaud sign-in has expired. Tap Renew, then start the walk.")
            }
        }
        guard !RecordingManager.shared.stateSubject.value.isActive else {
            log("Start refused: the recorder is already recording")
            return refuse("The recorder is already recording. Stop that recording on the Home tab, then start the walk.")
        }

        let cutSeconds = WalkSettings.cutSeconds
        var userId = JwtUtils.parse(DeviceManager.shared.userAccessToken)?.userId ?? RecordingStore.shared.userId ?? ""
        if userId.count < 6 { userId = "recorder-" + userId }

        cancelTimers()
        syncKick?.cancel()
        noticeClear?.cancel()
        lastStopAt = nil
        finishSent = false
        startInFlight = false
        waitingToResume = false
        lateCutWhileAway = false

        var fresh = Snapshot()
        fresh.phase = .starting
        fresh.cutSeconds = cutSeconds
        fresh.recorderConnected = true
        fresh.message = message("Creating the walk on the server.", .progress)
        state = fresh
        UIApplication.shared.isIdleTimerDisabled = true

        WalkBackend.shared.createWalk(userId: userId, cutSeconds: cutSeconds) { [weak self] result in
            guard let self = self, self.state.phase == .starting, self.state.walkId == nil else { return }
            switch result {
            case .failure(let error):
                self.log("Could not create the walk: \(error.localizedDescription)")
                self.reset()
                self.refuse("\(WalkBackend.plainReason(for: error)) The walk did not start, and nothing was recorded.")
            case .success(let walkId):
                self.update {
                    $0.walkId = walkId
                    $0.message = self.message("Starting the recording.", .progress)
                }
                self.log("Walk \(walkId) created, cutting every \(cutSeconds)s")
                self.sendStart()
            }
        }
    }

    func stopWalk() {
        switch state.phase {
        case .idle, .finishing:
            return
        case .starting, .recording, .cutting:
            cancelTimers()
            waitingToResume = false
            log("Stopping the walk")
            update {
                $0.phase = .finishing
                $0.nextCutAt = nil
                if $0.endedAt == nil, $0.startedAt != nil { $0.endedAt = Date() }
                $0.message = self.message("Stopping the recording.", .progress)
            }
            // The server hears that the walk is over now, not once the last recording has come
            // off the recorder, which can take minutes. It accepts recordings after this.
            if let walkId = state.walkId {
                WalkBackend.shared.finishWalk(walkId: walkId) { [weak self] result in
                    if case .failure(let error) = result {
                        self?.log("Could not tell the server the walk has stopped: \(error.localizedDescription)")
                    }
                }
            }
            if RecordingManager.shared.stateSubject.value.isActive {
                sendStop()
            } else if startInFlight {
                // A start is on its way to the device. Wait for it to land so it can be stopped;
                // if it never does, nothing is recording.
                watchForAck { [weak self] in
                    guard let self = self, self.state.phase == .finishing else { return }
                    self.startInFlight = false
                    self.finishIfComplete()
                }
            } else {
                finishIfComplete()
            }
        }
    }

    /// Ends a walk that is waiting for the device. Recordings the device has not handed over are
    /// given up on (the audio stays on the device); recordings on their way to the server carry on.
    func finishNow() {
        guard state.phase == .finishing, !finishSent else { return }
        log("Finishing without waiting for the recorder")
        cancelTimers()
        syncKick?.cancel()
        startInFlight = false
        update {
            for index in $0.chunks.indices {
                switch $0.chunks[index].stage {
                case .recording, .waitingForSync:
                    $0.chunks[index].stage = .failed(Self.notSyncedReason)
                case .uploading, .sent, .failed:
                    break
                }
            }
        }
        concludeWalk()
    }

    /// Sends every failed recording whose audio is on the phone again, and tells the server the
    /// walk is over if it has not heard. Works during a walk and after it has finished.
    func retryFailed() {
        guard let walkId = state.walkId else { return }
        var sending = 0
        for chunk in state.chunks where chunk.canSendAgain {
            guard let path = chunk.audioPath,
                  let index = state.chunks.firstIndex(where: { $0.sessionId == chunk.sessionId }) else { continue }
            guard FileManager.default.fileExists(atPath: path) else {
                log("Recording \(chunk.sessionId) cannot be sent again: its file is no longer on the phone")
                update {
                    $0.chunks[index].stage = .failed("the audio file is no longer on the phone")
                    $0.chunks[index].audioPath = nil
                }
                continue
            }
            state.chunks[index].uploadAttempts = 0
            sending += 1
            upload(sessionId: chunk.sessionId, path: path)
        }
        if sending > 0 {
            log("Sending \(sending) failed recording(s) again")
            showAboutSending(sending == 1 ? "Sending the recording again." : "Sending \(sending) recordings again.", .progress)
        }
        if state.finished, state.serverNotTold {
            if sending == 0 { showAboutSending("Telling the server that the walk is over.", .progress) }
            sendFinish(walkId: walkId, attempt: 1)
        }
    }

    // MARK: - Connection

    private func seedConnection() {
        state.recorderConnected = deviceIsConnected
    }

    /// Called whenever either of the starter's connection publishers says something. Finding
    /// the device is taken at its word at once; losing it has to last a few seconds.
    private func connectionMayHaveChanged() {
        if deviceIsConnected {
            lostCheck?.cancel()
            lostCheck = nil
            guard !state.recorderConnected else { return }
            if state.isActive {
                recorderReturned()
            } else {
                state.recorderConnected = true
            }
            return
        }
        guard state.recorderConnected, lostCheck == nil else { return }
        let work = DispatchWorkItem { [weak self] in
            guard let self = self else { return }
            self.lostCheck = nil
            guard !self.deviceIsConnected, self.state.recorderConnected else { return }
            if self.state.isActive {
                self.recorderLost()
            } else {
                self.state.recorderConnected = false
            }
        }
        lostCheck = work
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.outOfRangeDelay, execute: work)
    }

    private func recorderLost() {
        log("The recorder is out of reach (the app reports it as \(DeviceManager.shared.currentConnectionState))")
        noticeClear?.cancel()
        update {
            $0.recorderConnected = false
            $0.message = self.outOfRangeMessage($0)
        }
        scheduleConnectionRecheck()
    }

    private static let notRecordingText = "The recorder went out of range between two recordings, so it is not recording now. Bring the phone closer. Recording starts again as soon as the recorder is back in range."
    private static let stopNotHeardText = "The recorder is out of range, so it has not been told to stop. Bring the phone closer, or press the button on the recorder. You can also finish without the last recording."

    /// What to say while the device is out of reach, which depends on what it was doing.
    private func outOfRangeMessage(_ snapshot: Snapshot) -> Message {
        if waitingToResume {
            return message(Self.notRecordingText, .problem)
        }
        switch snapshot.phase {
        case .starting:
            return message("The recorder went out of range before it started recording. The phone is reconnecting.", .notice)
        case .finishing:
            if snapshot.chunks.contains(where: { $0.stage == .recording }) {
                return message(Self.stopNotHeardText, .problem)
            }
            return message("The recorder is out of range. The phone is reconnecting. The recordings still on the recorder are safe and are collected when it is back.", .notice)
        case .idle, .recording, .cutting:
            return message("The recorder is out of range. It keeps recording by itself, the phone is reconnecting, and nothing is lost.", .notice)
        }
    }

    private func recorderReturned() {
        log("The recorder is back in reach")
        connectionRecheck?.cancel()
        let returnedAt = Date()
        let notice = message(
            waitingToResume ? "The recorder is back in range. Starting the next recording." : "The recorder is back in range. Carrying on.",
            .notice
        )
        update {
            $0.recorderConnected = true
            $0.message = notice
        }
        clearLater(notice)
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.reconnectSettle) { [weak self] in
            self?.resumeAfterReconnect(since: returnedAt)
        }
    }

    /// Picks up what could not be done while the device was out of reach.
    private func resumeAfterReconnect(since returnedAt: Date) {
        guard state.recorderConnected, state.isActive else { return }
        let waitingForFiles = state.chunks.contains { $0.stage == .waitingForSync }
        if waitingForFiles, syncIsActive, lastSyncEventAt < returnedAt {
            // A sync that was running when the device dropped never ends by itself, and the
            // starter refuses to begin another while it thinks one is running.
            log("The sync from before the disconnect has gone quiet; starting it again")
            SyncManager.shared.stopSync()
        }
        switch state.phase {
        case .recording:
            if let due = state.nextCutAt, due <= Date() {
                log("The cut that came due while the recorder was out of reach")
                cut()
            }
        case .cutting:
            // A start sent just before the device dropped was never heard: send a fresh one.
            // When recording had already been given up on, waitToResume() starts it.
            if !waitingToResume, !RecordingManager.shared.stateSubject.value.isActive {
                sendStart()
            }
        case .finishing:
            if !finishSent, RecordingManager.shared.stateSubject.value.isActive {
                sendStop()
            }
        case .idle, .starting:
            break
        }
        scheduleSyncKick()
    }

    /// The SDK can have the device back before either publisher says so. While a walk believes
    /// the device is out of reach, ask again every few seconds.
    private func scheduleConnectionRecheck() {
        connectionRecheck?.cancel()
        guard state.isActive, !state.recorderConnected else { return }
        let work = DispatchWorkItem { [weak self] in
            guard let self = self else { return }
            self.connectionMayHaveChanged()
            self.scheduleConnectionRecheck()
        }
        connectionRecheck = work
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.connectionRecheckInterval, execute: work)
    }

    // MARK: - Background

    private func enteredBackground() {
        backgroundedAt = Date()
        if state.isActive { log("The app went to the background") }
    }

    /// Timers do not run while the app is suspended, so a cut can be long overdue by now. The
    /// device kept recording all the while.
    private func returnedToForeground() {
        guard let since = backgroundedAt else { return }
        backgroundedAt = nil
        let cutWasLate = lateCutWhileAway
        lateCutWhileAway = false
        guard state.phase == .recording || state.phase == .cutting else { return }
        let now = Date()
        let overdue = state.phase == .recording && (state.nextCutAt.map { $0 <= now } ?? false)
        guard overdue || cutWasLate else { return }

        let away = WalkText.duration(now.timeIntervalSince(since))
        log("Back after \(Int(now.timeIntervalSince(since)))s in the background; the cut was overdue")
        let notice = message(
            "The app was away for \(away). The recording carried on as one longer recording, and nothing was lost.",
            .notice
        )
        update {
            $0.lateReturns += 1
            $0.message = notice
        }
        clearLater(notice)
        if overdue { cut() }
    }

    // MARK: - Recorder events

    private func recorderChanged(_ recorder: RecordingState) {
        switch (state.phase, recorder) {

        case (.starting, .recording(let sessionId, _)), (.cutting, .recording(let sessionId, _)):
            guard state.walkId != nil else { return }
            ackWatchdog?.cancel()
            startInFlight = false
            let resumed = waitingToResume
            waitingToResume = false
            let gapMs = lastStopAt.map { Int(Date().timeIntervalSince($0) * 1000) }
            let nextCut = Date().addingTimeInterval(TimeInterval(state.cutSeconds))
            let alreadyListed = state.chunks.contains { $0.sessionId == sessionId }
            let recordingAgain = resumed ? message("The recorder is recording again.", .notice) : nil
            update { next in
                if !alreadyListed {
                    next.chunks.append(Chunk(sessionId: sessionId, stage: .recording, gapMs: gapMs))
                }
                if next.startedAt == nil { next.startedAt = Date() }
                next.phase = .recording
                next.nextCutAt = nextCut
                if let recordingAgain = recordingAgain {
                    next.message = recordingAgain
                } else if next.message?.kind == .progress {
                    // A step on the way is over. A notice or a problem stays to be read.
                    next.message = nil
                }
            }
            if let recordingAgain = recordingAgain { clearLater(recordingAgain) }
            if let gapMs = gapMs { log("Recording \(sessionId) started, \(gapMs) ms after the last one stopped") }
            else { log("Recording \(sessionId) started") }
            armCutTimer(for: nextCut)

        case (.cutting, .idle):
            // The stop we asked for. Start the next recording before doing anything else.
            ackWatchdog?.cancel()
            closeRecordingChunk()
            sendStart()

        case (.recording, .idle):
            // Stopped by the device button or from another screen: that ends the walk.
            closeRecordingChunk()
            log("The recording was stopped outside the walk; finishing")
            beginFinishing("The recording was stopped on the recorder, so the walk has ended. Collecting the last recording.", .notice)

        case (.finishing, .idle):
            ackWatchdog?.cancel()
            startInFlight = false
            closeRecordingChunk()
            finishIfComplete()

        case (.finishing, .recording(let sessionId, _)):
            // A start that was on its way when Stop was tapped. Stop it again.
            guard !finishSent, state.walkId != nil else { return }
            startInFlight = false
            if !state.chunks.contains(where: { $0.sessionId == sessionId }) {
                let gapMs = lastStopAt.map { Int(Date().timeIntervalSince($0) * 1000) }
                state.chunks.append(Chunk(sessionId: sessionId, stage: .recording, gapMs: gapMs))
            }
            log("Recording \(sessionId) started after Stop was tapped; stopping it")
            sendStop()

        default:
            break
        }
    }

    private func closeRecordingChunk() {
        guard let index = state.chunks.firstIndex(where: { $0.stage == .recording }) else { return }
        let now = Date()
        lastStopAt = now
        update {
            $0.chunks[index].stage = .waitingForSync
            $0.chunks[index].closedAt = now
        }
        log("Recording \(state.chunks[index].sessionId) closed")
        scheduleSyncKick()
    }

    // MARK: - Cutting

    private func armCutTimer(for date: Date) {
        cutTimer?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.cut() }
        cutTimer = work
        DispatchQueue.main.asyncAfter(deadline: .now() + max(0, date.timeIntervalSinceNow), execute: work)
    }

    private func cut() {
        guard state.phase == .recording else { return }
        guard state.recorderConnected else {
            // The time stays as it is, overdue, and the cut is made when the device is back.
            log("Time to cut, but the recorder is out of reach; cutting when it is back")
            return
        }
        if backgroundedAt != nil, let due = state.nextCutAt, Date().timeIntervalSince(due) > Self.lateCutSeconds {
            lateCutWhileAway = true
        }
        update {
            $0.phase = .cutting
            $0.nextCutAt = nil
        }
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
            let nextCut = Date().addingTimeInterval(TimeInterval(state.cutSeconds))
            update {
                $0.phase = .recording
                $0.nextCutAt = nextCut
            }
            armCutTimer(for: nextCut)
        } else {
            closeRecordingChunk()
            sendStart()
        }
    }

    private func sendStart() {
        ackRetried = false
        startInFlight = true
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
        startInFlight = false
        if state.phase == .cutting, !deviceIsConnected {
            // Out of reach in the second between two recordings. The walk goes on, and the next
            // recording starts when the device is back.
            log("The recorder went out of reach between two recordings; waiting for it")
            waitingToResume = true
            showOnce(Self.notRecordingText, .problem)
            waitToResume()
            return
        }
        log("The device did not start recording")
        if state.chunks.isEmpty {
            beginFinishing("The recorder did not start recording, so the walk did not start. Check the recorder on the Home tab, then try again.", .problem)
        } else {
            beginFinishing("The recorder did not start the next recording, so the walk has ended. What was recorded is being sent.", .problem)
        }
    }

    /// Recording stopped with the device out of reach. Looks every few seconds for the device
    /// and starts the next recording when it is there.
    private func waitToResume() {
        watchForAck { [weak self] in
            guard let self = self, self.state.phase == .cutting, self.waitingToResume else { return }
            if self.deviceIsConnected, !RecordingManager.shared.stateSubject.value.isActive {
                self.log("The recorder is back; starting the next recording")
                self.sendStart()
            } else {
                self.waitToResume()
            }
        }
    }

    /// The stop that ends the walk. Watched like a cut, so a stop the device never hears does
    /// not leave the walk saying it is stopping for ever.
    private func sendStop() {
        guard deviceIsConnected else {
            // Say so, and look again in a few seconds.
            stopNotConfirmed()
            watchForAck { [weak self] in
                guard let self = self, self.stopIsUnconfirmed else { return }
                self.sendStop()
            }
            return
        }
        ackRetried = false
        RecordingManager.shared.stopRecord()
        watchForAck { [weak self] in
            guard let self = self, self.stopIsUnconfirmed else { return }
            if !self.ackRetried {
                self.ackRetried = true
                self.log("No answer to the stop; sending it again")
                RecordingManager.shared.stopRecord()
                self.watchForAck { [weak self] in self?.stopNotConfirmed() }
            } else {
                self.stopNotConfirmed()
            }
        }
    }

    private var stopIsUnconfirmed: Bool {
        state.phase == .finishing && !finishSent && RecordingManager.shared.stateSubject.value.isActive
    }

    private func stopNotConfirmed() {
        guard stopIsUnconfirmed else { return }
        if deviceIsConnected {
            log("The recorder did not confirm the stop")
            showOnce("The recorder did not answer the stop. Press the button on the recorder to stop it, or finish without the last recording.", .problem)
        } else {
            log("The stop could not be sent: the recorder is out of reach")
            showOnce(Self.stopNotHeardText, .problem)
        }
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
            // Asking a device that is out of reach leaves the starter waiting for an answer.
            if self.deviceIsConnected, !self.syncIsActive,
               self.state.chunks.contains(where: { $0.stage == .waitingForSync }) {
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
                  state.chunks[index].audioPath == nil,
                  let path = RecordingStore.shared.resolveAbsolutePath(for: file) else { continue }
            switch state.chunks[index].stage {
            case .waitingForSync:
                upload(sessionId: file.sessionId, path: path)
            case .recording:
                // The stop was never confirmed, but the file is here, so the recording is over.
                guard state.phase == .finishing else { continue }
                state.chunks[index].closedAt = Date()
                upload(sessionId: file.sessionId, path: path)
            case .failed:
                // Given up on while it was still on the device, and handed over after all.
                log("Recording \(file.sessionId) has come over from the recorder after all")
                state.chunks[index].uploadAttempts = 0
                upload(sessionId: file.sessionId, path: path)
            case .uploading, .sent:
                continue
            }
        }
    }

    private func upload(sessionId: Int, path: String) {
        guard let walkId = state.walkId,
              let index = state.chunks.firstIndex(where: { $0.sessionId == sessionId }) else { return }
        let size = (try? FileManager.default.attributesOfItem(atPath: path)[.size] as? Int) ?? 0
        let number = index + 1
        update {
            $0.chunks[index].stage = .uploading
            $0.chunks[index].bytes = size
            $0.chunks[index].audioPath = path
            $0.chunks[index].uploadAttempts += 1
        }
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
                  let index = self.state.chunks.firstIndex(where: { $0.sessionId == sessionId }),
                  self.state.chunks[index].stage == .uploading else { return }
            switch result {
            case .success:
                self.update {
                    $0.chunks[index].stage = .sent
                    $0.chunks[index].sentAt = Date()
                }
                self.log("Recording \(sessionId) sent")
                self.uploadSettled(sent: true)
            case .failure(let error):
                let reason = WalkBackend.plainReason(for: error)
                if attempt < Self.maxUploadAttempts, WalkBackend.isWorthRetrying(error) {
                    self.log("Upload of \(sessionId) failed (\(error.localizedDescription)); retrying")
                    self.showAboutSending("\(reason) Recording \(number) is safe on the phone and will be sent again.", .notice)
                    DispatchQueue.main.asyncAfter(deadline: .now() + Double(attempt) * 3) { [weak self] in
                        guard let self = self, self.state.walkId == walkId,
                              let index = self.state.chunks.firstIndex(where: { $0.sessionId == sessionId }),
                              self.state.chunks[index].stage == .uploading else { return }
                        self.upload(sessionId: sessionId, path: path)
                    }
                    return
                }
                self.log("Upload of \(sessionId) failed for good: \(error.localizedDescription)")
                self.update {
                    $0.chunks[index].stage = .failed(reason)
                    $0.message = self.message(
                        "Recording \(number) could not be sent. \(reason) It is safe on the phone. Tap Send again once that is put right.",
                        .problem
                    )
                }
                self.uploadSettled(sent: false)
            }
        }
    }

    private func uploadSettled(sent: Bool) {
        // What was said about trouble sending is over once a recording has gone through.
        let aboutSending = sent && state.message != nil && state.message?.id == sendingMessageId
        if state.phase == .finishing {
            if aboutSending { state.message = nil }
            finishIfComplete()
        } else if state.finished {
            if sent { state.message = resultMessage(state, afterSendingAgain: true) }
        } else if aboutSending {
            state.message = restingMessage()
        }
    }

    /// A recording is being held back because the phone has no connection.
    private func uploadIsWaiting() {
        guard state.walkId != nil, state.chunks.contains(where: { $0.stage == .uploading }) else { return }
        log("An upload is waiting for the phone to get a connection")
        showAboutSending("No connection to the server. The recording is safe on the phone and will be sent when the connection is back.", .notice)
    }

    // MARK: - Finishing

    private func beginFinishing(_ text: String, _ kind: MessageKind) {
        cancelTimers()
        waitingToResume = false
        update {
            $0.phase = .finishing
            $0.nextCutAt = nil
            if $0.endedAt == nil, $0.startedAt != nil { $0.endedAt = Date() }
            $0.message = self.message(text, kind)
        }
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
            if state.message == nil || state.message?.kind == .progress {
                let waiting = waitingMessage(state)
                if state.message?.text != waiting.text { state.message = waiting }
            }
            scheduleSyncKick()
            return
        }
        concludeWalk()
    }

    /// The walk is over on the phone. The server is told in the background, so a server that
    /// cannot be reached does not hold the screen in "Finishing".
    private func concludeWalk() {
        guard !finishSent else { return }
        guard let walkId = state.walkId else { return reset() }
        finishSent = true
        cancelTimers()
        syncKick?.cancel()
        connectionRecheck?.cancel()
        noticeClear?.cancel()
        UIApplication.shared.isIdleTimerDisabled = false
        let problem = state.message?.kind == .problem ? state.message : nil
        update {
            $0.phase = .idle
            $0.finished = true
            $0.nextCutAt = nil
            if $0.endedAt == nil, $0.startedAt != nil { $0.endedAt = Date() }
            // A walk that never recorded keeps the reason it gave.
            if let problem = problem, $0.chunks.isEmpty {
                $0.message = problem
            } else {
                $0.message = self.resultMessage($0, afterSendingAgain: false)
            }
        }
        let sent = state.chunks.filter { $0.stage == .sent }.count
        log("Walk finished: \(sent) of \(state.chunks.count) recordings sent")
        sendFinish(walkId: walkId, attempt: 1)
    }

    private func sendFinish(walkId: String, attempt: Int) {
        WalkBackend.shared.finishWalk(walkId: walkId) { [weak self] result in
            guard let self = self, self.state.walkId == walkId, self.state.finished else { return }
            switch result {
            case .success:
                self.log("The server has marked the walk finished")
                if self.state.serverNotTold {
                    self.update {
                        $0.serverNotTold = false
                        $0.message = self.resultMessage($0, afterSendingAgain: true)
                    }
                }
            case .failure(let error):
                self.log("Could not mark the walk finished (attempt \(attempt)): \(error.localizedDescription)")
                if attempt < Self.maxFinishAttempts, WalkBackend.isWorthRetrying(error) {
                    DispatchQueue.main.asyncAfter(deadline: .now() + Double(attempt) * 3) { [weak self] in
                        guard let self = self, self.state.walkId == walkId, self.state.finished else { return }
                        self.sendFinish(walkId: walkId, attempt: attempt + 1)
                    }
                    return
                }
                // With nothing recorded there is nothing for the server to finish.
                guard !self.state.chunks.isEmpty else { return }
                self.update {
                    $0.serverNotTold = true
                    $0.message = self.message(
                        "\(WalkBackend.plainReason(for: error)) The server has not been told that the walk is over. Tap Send again once that is put right.",
                        .problem
                    )
                }
            }
        }
    }

    /// Back to idle with nothing on show.
    private func reset() {
        cancelTimers()
        syncKick?.cancel()
        connectionRecheck?.cancel()
        noticeClear?.cancel()
        startInFlight = false
        waitingToResume = false
        UIApplication.shared.isIdleTimerDisabled = false
        var fresh = Snapshot()
        fresh.recorderConnected = deviceIsConnected
        state = fresh
    }

    // MARK: - Messages

    private func message(_ text: String, _ kind: MessageKind) -> Message {
        messageSerial += 1
        return Message(id: messageSerial, text: text, kind: kind)
    }

    private func show(_ text: String, _ kind: MessageKind) {
        noticeClear?.cancel()
        state.message = message(text, kind)
    }

    /// For something that is looked at again every few seconds: says it the first time only.
    private func showOnce(_ text: String, _ kind: MessageKind) {
        guard state.message?.text != text else { return }
        show(text, kind)
    }

    /// A message about sending a recording, taken down when a recording next goes through.
    private func showAboutSending(_ text: String, _ kind: MessageKind) {
        guard state.message?.text != text else { return }
        show(text, kind)
        sendingMessageId = state.message?.id
    }

    private func refuse(_ text: String) {
        show(text, .problem)
    }

    /// Takes a notice down after a while, unless something else has been said since.
    private func clearLater(_ notice: Message) {
        noticeClear?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self = self, self.state.message == notice else { return }
            self.state.message = self.restingMessage()
        }
        noticeClear = work
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.noticeSeconds, execute: work)
    }

    /// What the message line says when nothing in particular has just happened.
    private func restingMessage() -> Message? {
        switch state.phase {
        case .idle:
            return state.message
        case .finishing:
            return state.recorderConnected ? waitingMessage(state) : outOfRangeMessage(state)
        case .starting, .recording, .cutting:
            return state.recorderConnected ? nil : outOfRangeMessage(state)
        }
    }

    private func waitingMessage(_ snapshot: Snapshot) -> Message {
        let stillRecording = snapshot.chunks.contains { $0.stage == .recording }
        let onRecorder = snapshot.chunks.filter { $0.stage == .waitingForSync }.count
        if stillRecording {
            return message("Stopping the recording.", .progress)
        }
        if onRecorder == 1 {
            return message("Collecting the last recording from the recorder.", .progress)
        }
        if onRecorder > 1 {
            return message("Collecting the last \(onRecorder) recordings from the recorder.", .progress)
        }
        return message("Sending the last of the walk to the server.", .progress)
    }

    private func resultMessage(_ snapshot: Snapshot, afterSendingAgain: Bool) -> Message {
        let total = snapshot.chunks.count
        let notSent = snapshot.notSentCount
        let sending = snapshot.chunks.filter { $0.stage == .uploading }.count
        if total == 0 {
            return message("Walk finished. Nothing was recorded.", .notice)
        }
        if notSent > 0 {
            var text = notSent == 1
                ? "Walk finished. 1 of \(total) recordings was not sent."
                : "Walk finished. \(notSent) of \(total) recordings were not sent."
            if snapshot.sendAgainCount > 0 {
                text += " The audio is safe on the phone. Tap Send again when the connection is good."
            } else {
                text += " The audio is still on the recorder. Sync the recorder from the Home tab and it is sent from here."
            }
            // Said as a problem when the walk ends; after that it is the same news, repeated.
            return message(text, afterSendingAgain ? .notice : .problem)
        }
        if snapshot.serverNotTold {
            return message("Walk finished. The server has not been told that the walk is over. Tap Send again.", afterSendingAgain ? .notice : .problem)
        }
        if sending > 0 {
            return message(sending == 1
                ? "Walk finished. The last recording is on its way to the server."
                : "Walk finished. The last \(sending) recordings are on their way to the server.", .notice)
        }
        return message(total == 1
            ? "Walk finished. The recording was sent."
            : "Walk finished. All \(total) recordings were sent.", .notice)
    }

    // MARK: - Helpers

    /// Makes several changes and publishes them as one snapshot.
    private func update(_ change: (inout Snapshot) -> Void) {
        var next = state
        change(&next)
        state = next
    }

    private func log(_ message: String) {
        AppLog.log("[Walk] \(message)")
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        logSubject.send("\(formatter.string(from: Date()))  \(message)")
    }
}

/// Wording shared by the walk recorder and its screen.
enum WalkText {

    /// A length of time in words: "45 seconds", "3 minutes", "1 hour, 5 minutes".
    static func duration(_ seconds: TimeInterval) -> String {
        let whole = max(0, seconds.rounded())
        let formatter = DateComponentsFormatter()
        formatter.unitsStyle = .full
        if whole < 60 {
            formatter.allowedUnits = [.second]
        } else if whole < 3600 {
            formatter.allowedUnits = [.minute]
        } else {
            formatter.allowedUnits = [.hour, .minute]
        }
        return formatter.string(from: whole) ?? "\(Int(whole)) seconds"
    }

    /// A length of time to the second, for VoiceOver: "4 minutes, 12 seconds".
    static func spokenDuration(_ seconds: TimeInterval) -> String {
        let whole = max(0, seconds.rounded(.down))
        let formatter = DateComponentsFormatter()
        formatter.unitsStyle = .full
        formatter.allowedUnits = [.hour, .minute, .second]
        formatter.zeroFormattingBehavior = .dropLeading
        return formatter.string(from: whole) ?? "\(Int(whole)) seconds"
    }

    /// The walk clock: m:ss, and h:mm:ss past an hour.
    static func clock(_ seconds: TimeInterval) -> String {
        let whole = Int(max(0, seconds))
        let hours = whole / 3600
        let minutes = (whole % 3600) / 60
        let secs = whole % 60
        if hours > 0 { return String(format: "%d:%02d:%02d", hours, minutes, secs) }
        return String(format: "%d:%02d", minutes, secs)
    }
}
