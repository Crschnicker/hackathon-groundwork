import UIKit
import Combine

/// The Walk tab: start and stop a chunked walk, and watch each recording go from the device
/// to the server while walking.
final class WalkViewController: UIViewController {

    private let manager = WalkCutManager.shared
    private var cancellables = Set<AnyCancellable>()
    private var ticker: Timer?
    private var lastProgressPoll = Date.distantPast
    private var pollingWalkId: String?
    private var logLines: [String] = []

    private let scrollView = UIScrollView()
    private let stack = UIStackView()

    private let apiField = WalkViewController.makeField(placeholder: "https://….trycloudflare.com", keyboard: .URL)
    private let tokenField = WalkViewController.makeField(placeholder: "API token (if the server has one)", keyboard: .default)
    private let cutField = WalkViewController.makeField(placeholder: "90", keyboard: .numberPad)
    private let plaudTokenLabel = WalkViewController.makeLabel(PlaudTheme.caption(), PlaudTheme.gray5)
    private let refreshTokenButton = PlaudTheme.makeSecondaryButton(title: "Refresh Plaud token")

    private let walkButton = PlaudTheme.makePrimaryButton(title: "Start walk")
    private let statusLabel = WalkViewController.makeLabel(PlaudTheme.bodyEmphasized(), PlaudTheme.labelPrimary)
    private let messageLabel = WalkViewController.makeLabel(PlaudTheme.footnote(), PlaudTheme.gray5)
    private let chunksLabel = WalkViewController.makeLabel(.monospacedSystemFont(ofSize: 12, weight: .regular), PlaudTheme.labelPrimary)
    private let serverLabel = WalkViewController.makeLabel(PlaudTheme.footnote(), PlaudTheme.labelPrimary)
    private let transcriptLabel = WalkViewController.makeLabel(PlaudTheme.footnote(), PlaudTheme.gray5)
    private let logLabel = WalkViewController.makeLabel(.monospacedSystemFont(ofSize: 11, weight: .regular), PlaudTheme.gray5)

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Walk"
        view.backgroundColor = PlaudTheme.backgroundPrimary
        setupLayout()
        loadSettings()

        walkButton.addTarget(self, action: #selector(walkTapped), for: .touchUpInside)
        refreshTokenButton.addTarget(self, action: #selector(refreshTokenTapped), for: .touchUpInside)
        view.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(endEditing)))

        manager.snapshotPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] in self?.render($0) }
            .store(in: &cancellables)

        manager.logPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] line in
                guard let self = self else { return }
                self.logLines.append(line)
                if self.logLines.count > 60 { self.logLines.removeFirst(self.logLines.count - 60) }
                self.logLabel.text = self.logLines.reversed().joined(separator: "\n")
            }
            .store(in: &cancellables)
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        renderPlaudToken()
        refreshPlaudTokenIfStale()
        ticker?.invalidate()
        ticker = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.tick() }
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        saveSettings()
        ticker?.invalidate()
        ticker = nil
    }

    // MARK: - Layout

    private static func makeField(placeholder: String, keyboard: UIKeyboardType) -> UITextField {
        let field = UITextField()
        field.placeholder = placeholder
        field.keyboardType = keyboard
        field.autocapitalizationType = .none
        field.autocorrectionType = .no
        field.borderStyle = .roundedRect
        field.font = PlaudTheme.footnote()
        field.clearButtonMode = .whileEditing
        field.heightAnchor.constraint(equalToConstant: 40).isActive = true
        return field
    }

    private static func makeLabel(_ font: UIFont, _ color: UIColor) -> UILabel {
        let label = UILabel()
        label.font = font
        label.textColor = color
        label.numberOfLines = 0
        return label
    }

    private static func makeHeading(_ text: String) -> UILabel {
        let label = makeLabel(PlaudTheme.caption(), PlaudTheme.gray5)
        label.text = text.uppercased()
        return label
    }

    private func setupLayout() {
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        scrollView.keyboardDismissMode = .interactive
        scrollView.alwaysBounceVertical = true
        view.addSubview(scrollView)

        stack.axis = .vertical
        stack.spacing = 10
        stack.translatesAutoresizingMaskIntoConstraints = false
        scrollView.addSubview(stack)

        walkButton.heightAnchor.constraint(equalToConstant: 52).isActive = true
        refreshTokenButton.heightAnchor.constraint(equalToConstant: 40).isActive = true
        refreshTokenButton.layer.borderWidth = 1
        refreshTokenButton.layer.borderColor = PlaudTheme.gray2.cgColor

        let rows: [UIView] = [
            statusLabel, messageLabel, walkButton,
            Self.makeHeading("Recordings"), chunksLabel,
            Self.makeHeading("On the server"), serverLabel, transcriptLabel,
            Self.makeHeading("Groundwork API address"), apiField, tokenField,
            Self.makeHeading("Seconds between cuts"), cutField,
            Self.makeHeading("Plaud token"), plaudTokenLabel, refreshTokenButton,
            Self.makeHeading("Log"), logLabel,
        ]
        rows.forEach { stack.addArrangedSubview($0) }
        stack.setCustomSpacing(20, after: walkButton)
        stack.setCustomSpacing(20, after: chunksLabel)
        stack.setCustomSpacing(20, after: transcriptLabel)
        stack.setCustomSpacing(20, after: cutField)
        stack.setCustomSpacing(20, after: refreshTokenButton)

        NSLayoutConstraint.activate([
            scrollView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            scrollView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scrollView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            stack.topAnchor.constraint(equalTo: scrollView.contentLayoutGuide.topAnchor, constant: 16),
            stack.leadingAnchor.constraint(equalTo: scrollView.frameLayoutGuide.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: scrollView.frameLayoutGuide.trailingAnchor, constant: -20),
            // Leave room for the floating tab bar.
            stack.bottomAnchor.constraint(equalTo: scrollView.contentLayoutGuide.bottomAnchor, constant: -110),
        ])
    }

    // MARK: - Settings

    private func loadSettings() {
        apiField.text = WalkSettings.apiURL
        tokenField.text = WalkSettings.apiToken
        tokenField.isSecureTextEntry = true
        cutField.text = String(WalkSettings.cutSeconds)
    }

    private func saveSettings() {
        WalkSettings.apiURL = apiField.text ?? ""
        WalkSettings.apiToken = tokenField.text ?? ""
        if let seconds = Int(cutField.text ?? ""), seconds >= WalkSettings.minimumCutSeconds {
            WalkSettings.cutSeconds = seconds
        }
        cutField.text = String(WalkSettings.cutSeconds)
    }

    @objc private func endEditing() {
        view.endEditing(true)
        saveSettings()
    }

    // MARK: - Actions

    @objc private func walkTapped() {
        endEditing()
        if manager.snapshot.phase == .idle {
            logLines.removeAll()
            logLabel.text = nil
            serverLabel.text = nil
            transcriptLabel.text = nil
            manager.startWalk()
        } else {
            manager.stopWalk()
        }
    }

    @objc private func refreshTokenTapped() {
        endEditing()
        plaudTokenLabel.text = "Asking the server for a new token…"
        WalkBackend.shared.refreshPlaudToken { [weak self] result in
            if case .failure(let error) = result {
                self?.plaudTokenLabel.text = "Could not refresh: \(error.localizedDescription)"
            } else {
                self?.renderPlaudToken()
            }
        }
    }

    /// A token that runs out mid-walk would stop the device syncing, so renew with time to spare.
    private func refreshPlaudTokenIfStale() {
        guard manager.snapshot.phase == .idle, !WalkSettings.apiURL.isEmpty,
              let expiry = WalkBackend.shared.plaudTokenExpiry,
              expiry.timeIntervalSinceNow < 4 * 3600 else { return }
        WalkBackend.shared.refreshPlaudToken { [weak self] _ in self?.renderPlaudToken() }
    }

    private func renderPlaudToken() {
        guard let expiry = WalkBackend.shared.plaudTokenExpiry else {
            plaudTokenLabel.text = "No readable Plaud token in this build."
            return
        }
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        let when = formatter.string(from: expiry)
        plaudTokenLabel.text = expiry < Date() ? "Expired \(when). Refresh it before connecting the device." : "Valid until \(when)."
    }

    // MARK: - Rendering

    private func render(_ snapshot: WalkCutManager.Snapshot) {
        let active = snapshot.phase != .idle
        walkButton.setTitle(active ? "Stop walk" : "Start walk", for: .normal)
        walkButton.backgroundColor = active ? UIColor(hex: "#c0392b") : .black
        walkButton.isEnabled = snapshot.phase != .finishing
        walkButton.alpha = walkButton.isEnabled ? 1 : 0.5
        [apiField, tokenField, cutField].forEach { $0.isEnabled = !active }

        statusLabel.text = statusText(snapshot)
        messageLabel.text = snapshot.message
        messageLabel.isHidden = snapshot.message == nil

        if snapshot.chunks.isEmpty {
            chunksLabel.text = "None yet."
        } else {
            chunksLabel.text = snapshot.chunks.enumerated().reversed().map { (index, chunk) -> String in
                var line = "#\(index + 1)  \(stageText(chunk.stage))"
                if let bytes = chunk.bytes { line += "  \(bytes / 1024) KB" }
                if let gap = chunk.gapMs { line += "  gap \(gap) ms" }
                if let closed = chunk.closedAt, let sent = chunk.sentAt {
                    line += "  sent \(Int(sent.timeIntervalSince(closed)))s after closing"
                }
                return line
            }.joined(separator: "\n")
        }
        if snapshot.walkId != pollingWalkId {
            pollingWalkId = snapshot.walkId
            lastProgressPoll = .distantPast
        }
    }

    private func statusText(_ snapshot: WalkCutManager.Snapshot) -> String {
        switch snapshot.phase {
        case .idle: return snapshot.walkId == nil ? "Ready" : "Walk finished"
        case .starting: return "Starting…"
        case .cutting: return "Cutting…"
        case .finishing: return "Finishing…"
        case .recording:
            guard let next = snapshot.nextCutAt else { return "Recording" }
            return "Recording · next cut in \(max(0, Int(next.timeIntervalSinceNow.rounded())))s"
        }
    }

    private func stageText(_ stage: WalkCutManager.ChunkStage) -> String {
        switch stage {
        case .recording: return "recording"
        case .waitingForSync: return "waiting for sync"
        case .uploading: return "uploading"
        case .sent: return "sent"
        case .failed(let reason): return "FAILED \(reason)"
        }
    }

    private func tick() {
        let snapshot = manager.snapshot
        if snapshot.phase == .recording { statusLabel.text = statusText(snapshot) }
        guard let walkId = snapshot.walkId, Date().timeIntervalSince(lastProgressPoll) >= 5 else { return }
        lastProgressPoll = Date()
        WalkBackend.shared.progress(walkId: walkId) { [weak self] result in
            guard let self = self, self.pollingWalkId == walkId else { return }
            switch result {
            case .failure(let error):
                self.serverLabel.text = "Cannot reach the server: \(error.localizedDescription)"
            case .success(let progress):
                self.renderProgress(progress)
                // Nothing more will change once a finished walk has settled.
                if progress.settled, self.manager.snapshot.phase == .idle { self.pollingWalkId = nil }
            }
        }
    }

    private func renderProgress(_ progress: WalkProgress) {
        var lines = ["\(progress.chunksDone) of \(progress.chunksTotal) recordings transcribed"]
        if progress.chunksFailed > 0 { lines.append("\(progress.chunksFailed) failed: \(progress.failures.first ?? "")") }
        if let slowest = progress.slowestLatencyMs {
            lines.append("Slowest transcript took \(slowest / 1000)s after upload")
        }
        if !progress.areaNames.isEmpty {
            lines.append("Site model: \(progress.areaNames.joined(separator: ", ")) · \(progress.openQuestions) open questions")
        }
        serverLabel.text = lines.joined(separator: "\n")
        transcriptLabel.text = progress.transcript.isEmpty ? nil : String(progress.transcript.suffix(600))
    }
}
