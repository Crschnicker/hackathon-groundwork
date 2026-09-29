import UIKit
import Combine
import AVFoundation

/// Site photos taken during a walk. The architect points the phone at whatever the proposal
/// should show; each photo is kept on the phone until the server has it, and the server works
/// out which area of the site it shows from what was being said when it was taken.
///
/// Putting the ready-made card on a screen takes two lines:
///
///     let photos = WalkPhotosView(presenter: self, walkId: { [weak self] in self?.manager.snapshot.walkId })
///     contentStack.addArrangedSubview(photos)
enum WalkPhotos {

    /// Opens the camera for one photo of the walk. `prompt` is shown over the camera, for a photo
    /// the walk guide asks for. Where there is no camera (the simulator) the photo library opens.
    static func present(
        from presenter: UIViewController,
        walkId: String,
        sectionId: String? = nil,
        promptId: String? = nil,
        prompt: String? = nil
    ) {
        let request = WalkPhotoRequest(walkId: walkId, sectionId: sectionId, promptId: promptId, prompt: prompt)
        guard UIImagePickerController.isSourceTypeAvailable(.camera) else {
            WalkPhotoPicker.show(.photoLibrary, request, from: presenter)
            return
        }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            WalkPhotoPicker.show(.camera, request, from: presenter)
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak presenter] granted in
                DispatchQueue.main.async {
                    guard let presenter = presenter else { return }
                    if granted {
                        WalkPhotoPicker.show(.camera, request, from: presenter)
                    } else {
                        WalkPhotos.showCameraRefused(from: presenter)
                    }
                }
            }
        case .denied, .restricted:
            WalkPhotos.showCameraRefused(from: presenter)
        @unknown default:
            WalkPhotoPicker.show(.camera, request, from: presenter)
        }
    }

    /// "Take photo", for the walk `walkId` names when it is tapped. It looks switched off while
    /// there is no walk, and says why when tapped.
    static func makeButton(presenter: UIViewController, walkId: @escaping () -> String?) -> UIButton {
        WalkPhotoButton(presenter: presenter, walkId: walkId)
    }

    /// The camera was turned down once, and only Settings can allow it now.
    private static func showCameraRefused(from presenter: UIViewController) {
        let alert = UIAlertController(
            title: "The camera is not allowed",
            message: "Groundwork Walk needs the camera to take site photos. Allow it in Settings, under Groundwork Walk.",
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "Open Settings", style: .default) { _ in
            guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
            UIApplication.shared.open(url)
        })
        alert.addAction(UIAlertAction(title: "Not now", style: .cancel))
        WalkPhotos.topmost(from: presenter).present(alert, animated: true)
    }

    /// The controller to present from: whatever is already on top of `presenter`.
    fileprivate static func topmost(from presenter: UIViewController) -> UIViewController {
        var top = presenter
        while let next = top.presentedViewController, !next.isBeingDismissed { top = next }
        return top
    }
}

/// Colours and fonts for the photo pieces, the same as the rest of the Walk tab.
private enum WalkPhotoStyle {

    /// For anything that went wrong. 6.5:1 on white.
    static let problem = UIColor(hex: "#B3261E")
    /// For secondary text. 6.4:1 on white.
    static let secondary = UIColor(hex: "#5F5F5F")

    static let cardPadding: CGFloat = 16
    static let minimumTarget: CGFloat = 44

    /// Follows the text size the user has chosen in Settings.
    static func font(
        _ size: CGFloat,
        _ weight: UIFont.Weight = .regular,
        style: UIFont.TextStyle = .body,
        maximum: CGFloat? = nil
    ) -> UIFont {
        let base = UIFont.systemFont(ofSize: size, weight: weight)
        let metrics = UIFontMetrics(forTextStyle: style)
        if let maximum = maximum { return metrics.scaledFont(for: base, maximumPointSize: maximum) }
        return metrics.scaledFont(for: base)
    }

    static func label(_ font: UIFont, _ color: UIColor, _ text: String? = nil) -> UILabel {
        let label = UILabel()
        label.font = font
        label.adjustsFontForContentSizeCategory = true
        label.textColor = color
        label.numberOfLines = 0
        label.text = text
        return label
    }

    /// White with a border, like the Walk tab's other buttons that are not the main one.
    static func secondaryButton(_ title: String) -> UIButton {
        let button = UIButton(type: .system)
        button.setTitle(title, for: .normal)
        button.setTitleColor(PlaudTheme.labelPrimary, for: .normal)
        button.tintColor = PlaudTheme.labelPrimary
        button.titleLabel?.font = font(16, .regular)
        button.titleLabel?.adjustsFontForContentSizeCategory = true
        button.titleLabel?.numberOfLines = 0
        button.titleLabel?.textAlignment = .center
        button.backgroundColor = .white
        button.layer.cornerRadius = 12
        button.layer.borderWidth = 1
        button.layer.borderColor = PlaudTheme.labelQuaternary.cgColor
        button.contentEdgeInsets = UIEdgeInsets(top: 8, left: 16, bottom: 8, right: 16)
        button.translatesAutoresizingMaskIntoConstraints = false
        button.heightAnchor.constraint(greaterThanOrEqualToConstant: minimumTarget).isActive = true
        return button
    }
}

// MARK: - Taking a photo

/// What a photo is for, carried from the button to the queue.
private struct WalkPhotoRequest {
    let walkId: String
    let sectionId: String?
    let promptId: String?
    let prompt: String?
}

/// Shows the system camera (or the library) for one photo and hands the result to the queue.
private final class WalkPhotoPicker: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {

    /// The picker holds its delegate weakly, so the one on screen is held here.
    private static var active: WalkPhotoPicker?

    private let request: WalkPhotoRequest

    private init(request: WalkPhotoRequest) {
        self.request = request
        super.init()
    }

    static func show(_ source: UIImagePickerController.SourceType, _ request: WalkPhotoRequest, from presenter: UIViewController) {
        let host = WalkPhotos.topmost(from: presenter)
        guard !(host is UIImagePickerController), UIImagePickerController.isSourceTypeAvailable(source) else { return }

        let coordinator = WalkPhotoPicker(request: request)
        let picker = UIImagePickerController()
        picker.sourceType = source
        picker.modalPresentationStyle = .fullScreen
        picker.delegate = coordinator

        var spokenPrompt: String?
        if source == .camera {
            picker.cameraCaptureMode = .photo
            if let prompt = request.prompt?.trimmingCharacters(in: .whitespacesAndNewlines), !prompt.isEmpty {
                picker.cameraOverlayView = WalkPhotoPromptOverlay(prompt: prompt)
                spokenPrompt = prompt
            }
        }

        WalkPhotoPicker.active = coordinator
        host.present(picker, animated: true) {
            if let spokenPrompt = spokenPrompt {
                UIAccessibility.post(notification: .announcement, argument: spokenPrompt)
            }
        }
    }

    func imagePickerController(
        _ picker: UIImagePickerController,
        didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
    ) {
        // The moment the photo is kept is close enough to the moment it was taken to line it
        // up with what was being said.
        let takenAt = Date()
        let image = info[.originalImage] as? UIImage
        let request = self.request
        picker.dismiss(animated: true) {
            guard image != nil else { return }
            UIAccessibility.post(notification: .announcement, argument: "Photo added to the walk.")
        }
        if let image = image {
            WalkPhotoQueue.shared.add(
                image,
                walkId: request.walkId,
                takenAt: takenAt,
                sectionId: request.sectionId,
                promptId: request.promptId
            )
        }
        WalkPhotoPicker.active = nil
    }

    func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
        picker.dismiss(animated: true)
        WalkPhotoPicker.active = nil
    }
}

/// The walk guide's words for the photo, in a banner over the camera. It takes no touches, so
/// the camera's own controls work through it.
private final class WalkPhotoPromptOverlay: UIView {

    init(prompt: String) {
        super.init(frame: UIScreen.main.bounds)
        autoresizingMask = [.flexibleWidth, .flexibleHeight]
        backgroundColor = .clear
        isUserInteractionEnabled = false

        let banner = UIView()
        banner.backgroundColor = UIColor.black.withAlphaComponent(0.65)
        banner.layer.cornerRadius = 12
        banner.translatesAutoresizingMaskIntoConstraints = false

        let label = WalkPhotoStyle.label(
            WalkPhotoStyle.font(17, .semibold, style: .headline, maximum: 28),
            .white,
            prompt
        )
        label.numberOfLines = 4
        label.textAlignment = .center
        label.translatesAutoresizingMaskIntoConstraints = false

        banner.addSubview(label)
        addSubview(banner)
        NSLayoutConstraint.activate([
            // Below the camera's flash and Live Photo controls.
            banner.topAnchor.constraint(equalTo: safeAreaLayoutGuide.topAnchor, constant: 64),
            banner.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 16),
            banner.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -16),
            label.topAnchor.constraint(equalTo: banner.topAnchor, constant: 10),
            label.leadingAnchor.constraint(equalTo: banner.leadingAnchor, constant: 14),
            label.trailingAnchor.constraint(equalTo: banner.trailingAnchor, constant: -14),
            label.bottomAnchor.constraint(equalTo: banner.bottomAnchor, constant: -10),
        ])
    }

    required init?(coder: NSCoder) { fatalError() }
}

/// "Take photo". It asks `walkId` once a second while on screen, because the walk starts and
/// ends elsewhere, and looks switched off while there is no walk.
private final class WalkPhotoButton: UIButton {

    private weak var presenter: UIViewController?
    private let walkId: () -> String?
    private var hasWalk = false
    private var watch: Timer?

    init(presenter: UIViewController, walkId: @escaping () -> String?) {
        self.presenter = presenter
        self.walkId = walkId
        super.init(frame: .zero)

        setTitle("Take photo", for: .normal)
        setTitleColor(PlaudTheme.labelPrimary, for: .normal)
        setImage(UIImage(systemName: "camera"), for: .normal)
        setPreferredSymbolConfiguration(UIImage.SymbolConfiguration(textStyle: .body), forImageIn: .normal)
        tintColor = PlaudTheme.labelPrimary
        titleLabel?.font = WalkPhotoStyle.font(16, .semibold, style: .headline)
        titleLabel?.adjustsFontForContentSizeCategory = true
        titleLabel?.adjustsFontSizeToFitWidth = true
        titleLabel?.minimumScaleFactor = 0.6
        backgroundColor = .white
        layer.cornerRadius = 12
        layer.borderWidth = 1
        layer.borderColor = PlaudTheme.labelQuaternary.cgColor
        // 8pt between the camera and the words; the right inset makes room for the shift.
        contentEdgeInsets = UIEdgeInsets(top: 8, left: 16, bottom: 8, right: 24)
        titleEdgeInsets = UIEdgeInsets(top: 0, left: 8, bottom: 0, right: -8)
        translatesAutoresizingMaskIntoConstraints = false
        heightAnchor.constraint(greaterThanOrEqualToConstant: WalkPhotoStyle.minimumTarget).isActive = true
        addTarget(self, action: #selector(tapped), for: .touchUpInside)

        // Photos left from an earlier run are sent as soon as there is a way to take more.
        WalkPhotoQueue.shared.resume()
        refresh()
    }

    required init?(coder: NSCoder) { fatalError() }

    deinit {
        watch?.invalidate()
    }

    override var isHighlighted: Bool {
        didSet { updateAlpha() }
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        watch?.invalidate()
        watch = nil
        guard window != nil else { return }
        refresh()
        watch = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.refresh() }
    }

    private func refresh() {
        hasWalk = walkId() != nil
        accessibilityHint = hasWalk ? nil : "Available once a walk has started."
        updateAlpha()
    }

    private func updateAlpha() {
        alpha = (isHighlighted ? 0.7 : 1) * (hasWalk ? 1 : 0.5)
    }

    @objc private func tapped() {
        guard let presenter = presenter else { return }
        guard let id = walkId() else {
            let alert = UIAlertController(
                title: "No walk yet",
                message: "Start a walk first. Each photo is added to the walk on this page.",
                preferredStyle: .alert
            )
            alert.addAction(UIAlertAction(title: "OK", style: .cancel))
            WalkPhotos.topmost(from: presenter).present(alert, animated: true)
            return
        }
        WalkPhotos.present(from: presenter, walkId: id)
    }
}

// MARK: - The queue

/// Keeps every site photo on the phone until the server has it. A walk passes through places
/// with no signal, and the app can be closed at any time, so each photo is written to
/// Application Support first, with a small index beside it, and sent from there one at a time.
///
/// All of its state lives on one serial queue; `stateSubject` can be read from any thread and
/// is meant to be received on the main queue.
final class WalkPhotoQueue {

    static let shared = WalkPhotoQueue()

    /// How the photos this phone took for one walk stand.
    struct Counts: Equatable {
        var taken = 0
        var sent = 0
        /// On the phone and still to be sent, including the one being sent now.
        var waiting = 0
        /// Refused by the server for a reason that sending again will not fix. Kept on the
        /// phone until `retryAll()`.
        var failed = 0
        /// Why the last photo that did not go through did not, in plain words.
        var lastError: String?
    }

    enum PhotoStage: Equatable {
        case waiting
        case sent
        case failed
    }

    /// A small copy of a photo taken since the app started, for a strip on screen.
    struct Thumbnail {
        let key: String
        let walkId: String
        let takenAt: Date
        let image: UIImage
        var stage: PhotoStage
    }

    struct State {
        var walks: [String: Counts] = [:]
        /// Why the last photo that did not go through did not, for any walk.
        var lastError: String?
        /// Set when a photo could not even be written to the phone.
        var saveError: String?
        /// The last few photos taken since the app started, oldest first.
        var recent: [Thumbnail] = []

        func counts(for walkId: String?) -> Counts {
            guard let walkId = walkId else { return Counts() }
            return walks[walkId] ?? Counts()
        }

        func thumbnails(for walkId: String?) -> [Thumbnail] {
            guard let walkId = walkId else { return [] }
            return recent.filter { $0.walkId == walkId }
        }
    }

    let stateSubject = CurrentValueSubject<State, Never>(State())
    var state: State { stateSubject.value }

    // MARK: - Private state (work queue only)

    /// One photo waiting to be sent. Written to the index, so it survives the app being closed.
    private struct Item: Codable {
        let key: String
        let walkId: String
        /// Epoch milliseconds, by the phone's clock.
        let takenAt: Int
        let sectionId: String?
        let promptId: String?
        var attempts: Int
        var lastError: String?
        var failed: Bool
    }

    private struct Index: Codable {
        var items: [Item]
        /// How many photos each walk has had sent, so the count survives the app restarting.
        var sent: [String: Int]
    }

    private struct Outcome {
        let reason: String
        let retry: Bool
    }

    private static let longSide: CGFloat = 2048
    private static let jpegQuality: CGFloat = 0.8
    private static let thumbnailLongSide: CGFloat = 240
    private static let maxThumbnails = 12

    private let work = DispatchQueue(label: "groundwork.walk-photos")
    private let session: URLSession
    private var cancellables = Set<AnyCancellable>()
    private var items: [Item] = []
    private var sentCounts: [String: Int] = [:]
    private var thumbnails: [Thumbnail] = []
    private var lastError: String?
    private var saveError: String?
    /// The photo being sent now; one at a time.
    private var uploadingKey: String?
    /// When a photo that failed for a passing reason is tried again. Kept in memory only, so
    /// everything waiting is tried at once when the app starts.
    private var nextAttempt: [String: Date] = [:]
    private var wake: DispatchWorkItem?

    /// Application Support/walk-photos; nil only if the folder cannot be made.
    private lazy var root: URL? = {
        let manager = FileManager.default
        guard let support = try? manager.url(
            for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true
        ) else { return nil }
        let root = support.appendingPathComponent("walk-photos", isDirectory: true)
        try? manager.createDirectory(at: root, withIntermediateDirectories: true)
        return root
    }()

    private init() {
        // A walk passes through places with no signal, so a photo waits for the connection to
        // come back before its attempt counts as failed.
        let config = URLSessionConfiguration.default
        config.waitsForConnectivity = true
        config.timeoutIntervalForRequest = 60
        config.timeoutIntervalForResource = 300
        session = URLSession(configuration: config)

        NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)
            .sink { [weak self] _ in self?.resume() }
            .store(in: &cancellables)

        work.async { [weak self] in
            guard let self = self else { return }
            self.load()
            self.publish()
            self.pump()
        }
    }

    // MARK: - Control

    /// Keeps a photo just taken and sends it. Call from any thread; the image is shrunk and
    /// written away from the main thread.
    func add(_ image: UIImage, walkId: String, takenAt: Date, sectionId: String? = nil, promptId: String? = nil) {
        let key = UUID().uuidString.lowercased()
        let takenAtMs = Int((takenAt.timeIntervalSince1970 * 1000).rounded())
        work.async { [weak self] in
            guard let self = self else { return }
            let item = Item(
                key: key,
                walkId: walkId,
                takenAt: takenAtMs,
                sectionId: sectionId,
                promptId: promptId,
                attempts: 0,
                lastError: nil,
                failed: false
            )
            guard let file = self.fileURL(for: item), let jpeg = WalkPhotoQueue.jpeg(from: image) else {
                self.saveError = "The last photo could not be kept on the phone. Take it again."
                self.publish()
                return
            }
            do {
                try FileManager.default.createDirectory(
                    at: file.deletingLastPathComponent(), withIntermediateDirectories: true
                )
                try jpeg.write(to: file, options: .atomic)
            } catch {
                self.saveError = "The last photo could not be kept on the phone. It may be full. Take it again once there is room."
                self.publish()
                return
            }
            self.saveError = nil
            self.items.append(item)
            self.save()
            if let small = WalkPhotoQueue.thumbnail(from: image) {
                self.thumbnails.append(Thumbnail(key: key, walkId: walkId, takenAt: takenAt, image: small, stage: .waiting))
                if self.thumbnails.count > WalkPhotoQueue.maxThumbnails {
                    self.thumbnails.removeFirst(self.thumbnails.count - WalkPhotoQueue.maxThumbnails)
                }
            }
            self.publish()
            self.pump()
        }
    }

    /// Sends again every photo that is waiting or was refused, starting now.
    func retryAll() {
        work.async { [weak self] in
            guard let self = self else { return }
            for index in self.items.indices {
                self.items[index].failed = false
                self.items[index].attempts = 0
            }
            self.nextAttempt.removeAll()
            self.lastError = nil
            self.save()
            self.publish()
            self.pump()
        }
    }

    /// Tries the photos that are waiting now, instead of when their wait is up. Called when
    /// the app becomes active; refused photos wait for `retryAll()`.
    func resume() {
        work.async { [weak self] in
            guard let self = self else { return }
            self.nextAttempt.removeAll()
            self.pump()
        }
    }

    // MARK: - Sending

    private func pump() {
        guard uploadingKey == nil else { return }
        let now = Date()
        guard let index = items.firstIndex(where: { !$0.failed && (nextAttempt[$0.key] ?? Date.distantPast) <= now }) else {
            scheduleWake()
            return
        }
        let item = items[index]

        guard let file = fileURL(for: item), FileManager.default.fileExists(atPath: file.path) else {
            // Nothing left to send.
            items.remove(at: index)
            nextAttempt[item.key] = nil
            lastError = "A photo was no longer on the phone, so it could not be sent."
            save()
            publish()
            pump()
            return
        }
        guard let request = makeRequest(for: item) else {
            items[index].lastError = "The server address is not set, or is not a web address."
            nextAttempt[item.key] = now.addingTimeInterval(120)
            save()
            publish()
            pump()
            return
        }

        items[index].attempts += 1
        uploadingKey = item.key
        save()
        publish()
        let key = item.key
        let task = session.uploadTask(with: request, fromFile: file) { [weak self] data, response, error in
            guard let self = self else { return }
            self.work.async { self.finished(key: key, data: data, response: response, error: error) }
        }
        task.resume()
    }

    private func finished(key: String, data: Data?, response: URLResponse?, error: Error?) {
        uploadingKey = nil
        guard let index = items.firstIndex(where: { $0.key == key }) else {
            pump()
            return
        }
        let item = items[index]
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0

        if error == nil, (200..<300).contains(status) {
            if let file = fileURL(for: item) { removeFile(file) }
            items.remove(at: index)
            nextAttempt[key] = nil
            sentCounts[item.walkId, default: 0] += 1
            if !items.contains(where: { $0.lastError != nil }) { lastError = nil }
        } else {
            let outcome: Outcome
            if let error = error {
                outcome = WalkPhotoQueue.outcome(for: error)
            } else {
                outcome = WalkPhotoQueue.outcome(forStatus: status, data: data)
            }
            items[index].lastError = outcome.reason
            lastError = outcome.reason
            if outcome.retry {
                let wait = WalkPhotoQueue.backoff(afterAttempt: items[index].attempts)
                nextAttempt[key] = Date().addingTimeInterval(wait)
            } else {
                items[index].failed = true
                nextAttempt[key] = nil
            }
        }
        save()
        publish()
        pump()
    }

    /// Wakes the queue when the soonest photo waiting to be tried again is due.
    private func scheduleWake() {
        wake?.cancel()
        wake = nil
        let due = items.filter { !$0.failed }.compactMap { nextAttempt[$0.key] }
        guard uploadingKey == nil, let soonest = due.min() else { return }
        let next = DispatchWorkItem { [weak self] in self?.pump() }
        wake = next
        work.asyncAfter(deadline: .now() + max(0.5, soonest.timeIntervalSinceNow), execute: next)
    }

    private func makeRequest(for item: Item) -> URLRequest? {
        let base = WalkSettings.apiURL
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_."))
        let walkPath = item.walkId.addingPercentEncoding(withAllowedCharacters: allowed) ?? item.walkId
        guard !base.isEmpty, var components = URLComponents(string: base + "/api/walks/" + walkPath + "/photos") else {
            return nil
        }
        var query = [
            URLQueryItem(name: "key", value: item.key),
            URLQueryItem(name: "takenAt", value: String(item.takenAt)),
            URLQueryItem(name: "source", value: "phone"),
        ]
        if let sectionId = item.sectionId { query.append(URLQueryItem(name: "sectionId", value: sectionId)) }
        if let promptId = item.promptId { query.append(URLQueryItem(name: "promptId", value: promptId)) }
        components.queryItems = query
        guard let url = components.url, let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https" else { return nil }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("image/jpeg", forHTTPHeaderField: "Content-Type")
        let token = WalkSettings.apiToken
        if !token.isEmpty { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        return request
    }

    /// 5 s, 15 s and a minute after the first three failures, then every two minutes.
    private static func backoff(afterAttempt attempt: Int) -> TimeInterval {
        switch attempt {
        case ...1: return 5
        case 2: return 15
        case 3: return 60
        default: return 120
        }
    }

    /// The connection failed. Worth trying again, unless the address itself is unusable.
    private static func outcome(for error: Error) -> Outcome {
        let nsError = error as NSError
        guard nsError.domain == NSURLErrorDomain else {
            return Outcome(reason: "The server could not be reached.", retry: true)
        }
        switch nsError.code {
        case NSURLErrorBadURL, NSURLErrorUnsupportedURL:
            return Outcome(reason: "The server address is not a web address.", retry: false)
        case NSURLErrorNotConnectedToInternet, NSURLErrorNetworkConnectionLost, NSURLErrorDataNotAllowed,
             NSURLErrorInternationalRoamingOff, NSURLErrorCallIsActive:
            return Outcome(reason: "The phone has no connection to the internet.", retry: true)
        case NSURLErrorTimedOut:
            return Outcome(reason: "The server took too long to answer.", retry: true)
        case NSURLErrorCannotFindHost, NSURLErrorDNSLookupFailed, NSURLErrorCannotConnectToHost:
            return Outcome(
                reason: "Nothing answers at the server address. If the tunnel was restarted, its address has changed.",
                retry: true
            )
        default:
            return Outcome(reason: "The server could not be reached.", retry: true)
        }
    }

    /// The server answered, but not with success. Busy or broken servers are tried again;
    /// anything else waits for `retryAll()` once whatever it was has been put right.
    private static func outcome(forStatus status: Int, data: Data?) -> Outcome {
        var serverSaid: String?
        if let data = data, let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
            serverSaid = json["error"] as? String
        }
        switch status {
        case 0:
            return Outcome(reason: "The server's answer could not be read.", retry: true)
        case 408:
            return Outcome(reason: "The server took too long to answer.", retry: true)
        case 429:
            return Outcome(reason: "The server is busy.", retry: true)
        case 502, 503, 504, 530:
            return Outcome(reason: "Nothing is answering behind the server address.", retry: true)
        case 500...599:
            return Outcome(reason: "The server had a problem of its own.", retry: true)
        case 401, 403:
            return Outcome(reason: "The server did not accept the server token.", retry: false)
        case 404:
            return Outcome(reason: "The server does not know this walk. The server address may be wrong.", retry: false)
        case 409:
            return Outcome(reason: "The walk has as many photos as it can take.", retry: false)
        case 413:
            return Outcome(reason: "The photo is too large for the server.", retry: false)
        default:
            if let said = serverSaid, !said.isEmpty, said.count <= 200 {
                var sentence = said
                if !sentence.hasSuffix(".") { sentence += "." }
                return Outcome(reason: "The server did not accept the photo: \(sentence)", retry: false)
            }
            return Outcome(reason: "The server did not accept the photo.", retry: false)
        }
    }

    // MARK: - Files

    private var indexURL: URL? { root?.appendingPathComponent("pending.json") }

    /// Application Support/walk-photos/<walkId>/<key>.jpg.
    private func fileURL(for item: Item) -> URL? {
        root?.appendingPathComponent(WalkPhotoQueue.folderName(item.walkId), isDirectory: true)
            .appendingPathComponent(item.key + ".jpg")
    }

    /// The walk id with anything that could not be in a folder name left out.
    private static func folderName(_ walkId: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_"))
        var name = ""
        for scalar in walkId.unicodeScalars where allowed.contains(scalar) {
            name.unicodeScalars.append(scalar)
        }
        return name.isEmpty ? "walk" : name
    }

    private func load() {
        guard let url = indexURL, let data = try? Data(contentsOf: url),
              let index = try? JSONDecoder().decode(Index.self, from: data) else { return }
        items = index.items
        sentCounts = index.sent
    }

    private func save() {
        guard let url = indexURL,
              let data = try? JSONEncoder().encode(Index(items: items, sent: sentCounts)) else { return }
        try? data.write(to: url, options: .atomic)
    }

    private func removeFile(_ file: URL) {
        let manager = FileManager.default
        try? manager.removeItem(at: file)
        let folder = file.deletingLastPathComponent()
        if let left = try? manager.contentsOfDirectory(atPath: folder.path), left.isEmpty {
            try? manager.removeItem(at: folder)
        }
    }

    // MARK: - Images

    /// The size to draw `image` at, in pixels, so its long side is at most `longSide`.
    private static func pixelSize(of image: UIImage, longSide: CGFloat) -> CGSize? {
        let width = image.size.width * image.scale
        let height = image.size.height * image.scale
        let longest = max(width, height)
        guard longest > 0 else { return nil }
        let factor = min(1, longSide / longest)
        return CGSize(width: max(1, (width * factor).rounded()), height: max(1, (height * factor).rounded()))
    }

    private static func renderer(size: CGSize) -> UIGraphicsImageRenderer {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        return UIGraphicsImageRenderer(size: size, format: format)
    }

    /// Drawing the photo also turns it the right way up, so the file needs no orientation tag.
    private static func jpeg(from image: UIImage) -> Data? {
        guard let size = pixelSize(of: image, longSide: longSide) else { return nil }
        let data = autoreleasepool { () -> Data in
            renderer(size: size).jpegData(withCompressionQuality: jpegQuality) { _ in
                image.draw(in: CGRect(origin: .zero, size: size))
            }
        }
        return data
    }

    private static func thumbnail(from image: UIImage) -> UIImage? {
        guard let size = pixelSize(of: image, longSide: thumbnailLongSide) else { return nil }
        let small = autoreleasepool { () -> UIImage in
            renderer(size: size).image { _ in
                image.draw(in: CGRect(origin: .zero, size: size))
            }
        }
        return small
    }

    // MARK: - Publishing

    private func publish() {
        var walks: [String: Counts] = [:]
        for (walkId, sent) in sentCounts {
            var counts = Counts()
            counts.sent = sent
            walks[walkId] = counts
        }
        for item in items {
            var counts = walks[item.walkId] ?? Counts()
            if item.failed { counts.failed += 1 } else { counts.waiting += 1 }
            // A refusal says more than a passing failure, so it is the one kept.
            if let error = item.lastError, item.failed || counts.failed == 0 { counts.lastError = error }
            walks[item.walkId] = counts
        }
        walks = walks.mapValues { value -> Counts in
            var counts = value
            counts.taken = counts.sent + counts.waiting + counts.failed
            return counts
        }

        var stages: [String: PhotoStage] = [:]
        for item in items { stages[item.key] = item.failed ? PhotoStage.failed : PhotoStage.waiting }
        let recent = thumbnails.map { thumbnail -> Thumbnail in
            var shown = thumbnail
            shown.stage = stages[thumbnail.key] ?? .sent
            return shown
        }

        stateSubject.send(State(walks: walks, lastError: lastError, saveError: saveError, recent: recent))
    }
}

// MARK: - The card

/// A ready-made card for the Walk tab: the Take photo button, how the walk's photos stand, and
/// the last few taken. It follows WalkPhotoQueue, and asks `walkId` once a second while on
/// screen, so it needs nothing more from the page it is on.
final class WalkPhotosView: UIView {

    private static let thumbnailSide: CGFloat = 64

    private let walkId: () -> String?
    private let queue = WalkPhotoQueue.shared
    private var cancellables = Set<AnyCancellable>()
    private var watch: Timer?
    private var shownWalkId: String?
    private var stripShown = ""

    private let stack = UIStackView()
    private let takeButton: UIButton
    private let statusLabel = WalkPhotoStyle.label(
        WalkPhotoStyle.font(15, .regular, style: .subheadline),
        WalkPhotoStyle.secondary
    )
    private let problemLabel = WalkPhotoStyle.label(
        WalkPhotoStyle.font(15, .regular, style: .subheadline),
        WalkPhotoStyle.problem
    )
    private let strip = UIScrollView()
    private let stripStack = UIStackView()
    private let sendAgainButton = WalkPhotoStyle.secondaryButton("Send again")

    init(presenter: UIViewController, walkId: @escaping () -> String?) {
        self.walkId = walkId
        takeButton = WalkPhotos.makeButton(presenter: presenter, walkId: walkId)
        super.init(frame: .zero)

        backgroundColor = .white
        layer.cornerRadius = 12
        stack.axis = .vertical
        stack.spacing = 8
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)

        let heading = WalkPhotoStyle.label(
            WalkPhotoStyle.font(16, .semibold, style: .headline),
            PlaudTheme.labelPrimary,
            "Site photos"
        )
        heading.accessibilityTraits = .header

        stripStack.axis = .horizontal
        stripStack.spacing = 8
        stripStack.translatesAutoresizingMaskIntoConstraints = false
        strip.showsHorizontalScrollIndicator = false
        strip.translatesAutoresizingMaskIntoConstraints = false
        strip.addSubview(stripStack)

        problemLabel.isHidden = true
        strip.isHidden = true
        sendAgainButton.isHidden = true
        sendAgainButton.addTarget(self, action: #selector(sendAgainTapped), for: .touchUpInside)

        let rows: [UIView] = [heading, statusLabel, problemLabel, strip, takeButton, sendAgainButton]
        rows.forEach { stack.addArrangedSubview($0) }
        stack.setCustomSpacing(12, after: statusLabel)
        stack.setCustomSpacing(12, after: problemLabel)
        stack.setCustomSpacing(12, after: strip)

        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: topAnchor, constant: WalkPhotoStyle.cardPadding),
            stack.leadingAnchor.constraint(equalTo: leadingAnchor, constant: WalkPhotoStyle.cardPadding),
            stack.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -WalkPhotoStyle.cardPadding),
            stack.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -WalkPhotoStyle.cardPadding),

            strip.heightAnchor.constraint(equalToConstant: Self.thumbnailSide),
            stripStack.topAnchor.constraint(equalTo: strip.contentLayoutGuide.topAnchor),
            stripStack.leadingAnchor.constraint(equalTo: strip.contentLayoutGuide.leadingAnchor),
            stripStack.trailingAnchor.constraint(equalTo: strip.contentLayoutGuide.trailingAnchor),
            stripStack.bottomAnchor.constraint(equalTo: strip.contentLayoutGuide.bottomAnchor),
            stripStack.heightAnchor.constraint(equalTo: strip.frameLayoutGuide.heightAnchor),
        ])

        queue.stateSubject
            .receive(on: DispatchQueue.main)
            .sink { [weak self] in self?.render($0) }
            .store(in: &cancellables)
    }

    required init?(coder: NSCoder) { fatalError() }

    deinit {
        watch?.invalidate()
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        watch?.invalidate()
        watch = nil
        guard window != nil else { return }
        render(queue.state)
        watch = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            guard let self = self, self.walkId() != self.shownWalkId else { return }
            self.render(self.queue.state)
        }
    }

    // MARK: - Rendering

    private func render(_ state: WalkPhotoQueue.State) {
        let current = walkId()
        shownWalkId = current
        let counts = state.counts(for: current)

        let text = Self.statusText(counts, hasWalk: current != nil)
        if statusLabel.text != text {
            statusLabel.text = text
            statusLabel.accessibilityLabel = text.replacingOccurrences(of: " · ", with: ", ")
        }

        let problem = state.saveError ?? Self.problemText(counts)
        if problemLabel.text != problem { problemLabel.text = problem }
        setHidden(problemLabel, problem == nil)
        setHidden(sendAgainButton, counts.failed == 0)

        renderStrip(state.thumbnails(for: current))
    }

    private static func statusText(_ counts: WalkPhotoQueue.Counts, hasWalk: Bool) -> String {
        guard hasWalk else { return "Photos can be taken once a walk has started." }
        guard counts.taken > 0 else {
            return "No photos yet. Each photo is added to the walk, beside what was being said when it was taken."
        }
        var parts = [counts.taken == 1 ? "1 photo" : "\(counts.taken) photos"]
        if counts.waiting > 0 { parts.append("\(counts.waiting) waiting to send") }
        if counts.failed > 0 { parts.append("\(counts.failed) not sent") }
        if counts.waiting == 0, counts.failed == 0 { parts.append(counts.taken == 1 ? "sent" : "all sent") }
        return parts.joined(separator: " · ")
    }

    private static func problemText(_ counts: WalkPhotoQueue.Counts) -> String? {
        guard let reason = counts.lastError else { return nil }
        if counts.failed > 0 {
            let which = counts.failed == 1
                ? "A photo was not accepted. \(reason) It is safe on the phone."
                : "\(counts.failed) photos were not accepted. \(reason) They are safe on the phone."
            return "\(which) Tap Send again once that is put right."
        }
        if counts.waiting > 0 {
            return "\(reason) The photos are safe on the phone and are sent when the server answers."
        }
        return nil
    }

    private func renderStrip(_ thumbnails: [WalkPhotoQueue.Thumbnail]) {
        setHidden(strip, thumbnails.isEmpty)
        let signature = thumbnails.map { "\($0.key):\($0.stage)" }.joined(separator: "|")
        guard signature != stripShown else { return }
        stripShown = signature
        stripStack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        // Newest first, where the eye lands.
        for thumbnail in thumbnails.reversed() {
            stripStack.addArrangedSubview(WalkPhotoThumbnailView(thumbnail, side: Self.thumbnailSide))
        }
        strip.setContentOffset(.zero, animated: false)
    }

    private func setHidden(_ view: UIView, _ hidden: Bool) {
        // A stack view miscounts when a view already hidden is hidden again.
        if view.isHidden != hidden { view.isHidden = hidden }
    }

    @objc private func sendAgainTapped() {
        queue.retryAll()
        UIAccessibility.post(notification: .announcement, argument: "Sending the photos again.")
    }
}

/// One photo in the strip, with a mark while it is still to be sent or was refused.
private final class WalkPhotoThumbnailView: UIView {

    init(_ thumbnail: WalkPhotoQueue.Thumbnail, side: CGFloat) {
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false

        let imageView = UIImageView(image: thumbnail.image)
        imageView.contentMode = .scaleAspectFill
        imageView.clipsToBounds = true
        imageView.layer.cornerRadius = 8
        imageView.translatesAutoresizingMaskIntoConstraints = false
        addSubview(imageView)
        NSLayoutConstraint.activate([
            widthAnchor.constraint(equalToConstant: side),
            heightAnchor.constraint(equalToConstant: side),
            imageView.topAnchor.constraint(equalTo: topAnchor),
            imageView.leadingAnchor.constraint(equalTo: leadingAnchor),
            imageView.trailingAnchor.constraint(equalTo: trailingAnchor),
            imageView.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])

        let words: String
        var symbol: String?
        var symbolColor: UIColor = PlaudTheme.labelPrimary
        switch thumbnail.stage {
        case .waiting:
            words = "waiting to send"
            symbol = "arrow.up.circle.fill"
        case .failed:
            words = "not sent"
            symbol = "exclamationmark.circle.fill"
            symbolColor = WalkPhotoStyle.problem
        case .sent:
            words = "sent"
        }

        if let symbol = symbol {
            let badge = UIImageView(image: UIImage(systemName: symbol))
            badge.tintColor = symbolColor
            badge.backgroundColor = .white
            badge.layer.cornerRadius = 10
            badge.clipsToBounds = true
            badge.contentMode = .scaleAspectFit
            badge.translatesAutoresizingMaskIntoConstraints = false
            addSubview(badge)
            NSLayoutConstraint.activate([
                badge.widthAnchor.constraint(equalToConstant: 20),
                badge.heightAnchor.constraint(equalToConstant: 20),
                badge.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -4),
                badge.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -4),
            ])
        }

        let formatter = DateFormatter()
        formatter.timeStyle = .short
        formatter.dateStyle = .none
        isAccessibilityElement = true
        accessibilityTraits = .image
        accessibilityLabel = "Photo taken at \(formatter.string(from: thumbnail.takenAt)), \(words)"
    }

    required init?(coder: NSCoder) { fatalError() }
}
