import UIKit
import Combine

/// Colours, fonts and small views for the Walk tab. The page sits beside Home, Files and
/// Settings, so it uses their page background, white cards and title, and adds only what
/// they do not have: text that scales, and colours dark enough to read outdoors.
private enum WalkStyle {

    /// For anything that went wrong. 6.5:1 on white, where .systemRed is about 3.7:1.
    static let problem = UIColor(hex: "#B3261E")
    /// For secondary text. 6.4:1 on white, where PlaudTheme.gray5 is about 3.7:1.
    static let secondary = UIColor(hex: "#5F5F5F")
    /// State dots. They carry no text, and the words beside them say the same thing.
    static let recordingDot = UIColor(hex: "#D92D20")
    static let cautionDot = UIColor(hex: "#C77700")
    static let goodDot = UIColor(hex: "#1E7B34")
    static let neutralDot = PlaudTheme.gray5

    static let margin: CGFloat = 24
    static let cardPadding: CGFloat = 16
    static let minimumTarget: CGFloat = 44

    /// Every font on the page comes through here, so all of it follows the text size the
    /// user has chosen in Settings.
    static func scaled(_ base: UIFont, style: UIFont.TextStyle = .body, maximum: CGFloat? = nil) -> UIFont {
        let metrics = UIFontMetrics(forTextStyle: style)
        if let maximum = maximum { return metrics.scaledFont(for: base, maximumPointSize: maximum) }
        return metrics.scaledFont(for: base)
    }

    static func font(_ size: CGFloat, _ weight: UIFont.Weight = .regular, style: UIFont.TextStyle = .body) -> UIFont {
        scaled(.systemFont(ofSize: size, weight: weight), style: style)
    }

    static func monospaced(_ size: CGFloat) -> UIFont {
        scaled(.monospacedSystemFont(ofSize: size, weight: .regular), style: .footnote)
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

    /// The title of a card, or of a part of Details.
    static func heading(_ text: String) -> UILabel {
        let label = self.label(font(16, .semibold, style: .headline), PlaudTheme.labelPrimary, text)
        label.accessibilityTraits = .header
        return label
    }

    /// The name above a text field.
    static func fieldName(_ text: String) -> UILabel {
        label(font(14, .regular, style: .subheadline), secondary, text)
    }

    static func dot(_ color: UIColor) -> UIView {
        let dot = UIView()
        dot.backgroundColor = color
        dot.layer.cornerRadius = 6
        dot.translatesAutoresizingMaskIntoConstraints = false
        dot.setContentHuggingPriority(.required, for: .horizontal)
        NSLayoutConstraint.activate([
            dot.widthAnchor.constraint(equalToConstant: 12),
            dot.heightAnchor.constraint(equalToConstant: 12),
        ])
        return dot
    }

    /// White with a border, for the things that are not the main button.
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

    static func field(placeholder: String, keyboard: UIKeyboardType, name: String) -> UITextField {
        let field = UITextField()
        field.placeholder = placeholder
        field.keyboardType = keyboard
        field.keyboardAppearance = .light
        field.autocapitalizationType = .none
        field.autocorrectionType = .no
        field.borderStyle = .roundedRect
        field.font = font(16, .regular)
        field.adjustsFontForContentSizeCategory = true
        field.textColor = PlaudTheme.labelPrimary
        field.clearButtonMode = .whileEditing
        field.returnKeyType = .done
        field.accessibilityLabel = name
        field.translatesAutoresizingMaskIntoConstraints = false
        field.heightAnchor.constraint(greaterThanOrEqualToConstant: minimumTarget).isActive = true
        return field
    }
}

/// A white card holding a column of views.
private final class WalkCard: UIView {

    let stack = UIStackView()

    init(spacing: CGFloat = 8) {
        super.init(frame: .zero)
        backgroundColor = .white
        layer.cornerRadius = 12
        stack.axis = .vertical
        stack.spacing = spacing
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: topAnchor, constant: WalkStyle.cardPadding),
            stack.leadingAnchor.constraint(equalTo: leadingAnchor, constant: WalkStyle.cardPadding),
            stack.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -WalkStyle.cardPadding),
            stack.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -WalkStyle.cardPadding),
        ])
    }

    required init?(coder: NSCoder) { fatalError() }

    func add(_ views: [UIView]) {
        views.forEach { stack.addArrangedSubview($0) }
    }
}

/// The dot and the few words at the top of the recorder card. VoiceOver reads it as one thing,
/// and asks for the walk time only when the user lands on it, so the clock is not read out
/// every second.
private final class WalkStatusRow: UIView {

    let dot = WalkStyle.dot(WalkStyle.neutralDot)
    let label = WalkStyle.label(WalkStyle.font(20, .semibold, style: .title3), PlaudTheme.labelPrimary)
    var spokenValue: (() -> String?)?

    override init(frame: CGRect) {
        super.init(frame: frame)
        let row = UIStackView(arrangedSubviews: [dot, label])
        row.axis = .horizontal
        row.alignment = .center
        row.spacing = 10
        row.translatesAutoresizingMaskIntoConstraints = false
        addSubview(row)
        NSLayoutConstraint.activate([
            row.topAnchor.constraint(equalTo: topAnchor),
            row.leadingAnchor.constraint(equalTo: leadingAnchor),
            row.trailingAnchor.constraint(equalTo: trailingAnchor),
            row.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
        isAccessibilityElement = true
    }

    required init?(coder: NSCoder) { fatalError() }

    override var accessibilityValue: String? {
        get { spokenValue?() }
        set { }
    }
}

/// One line of "Before you start": a dot, what is needed, and how it stands, in words.
private final class WalkCheckRow: UIView {

    let button = WalkStyle.secondaryButton("Renew")
    private let dot = WalkStyle.dot(WalkStyle.neutralDot)
    private let nameLabel: UILabel
    private let stateLabel = WalkStyle.label(WalkStyle.font(15, .regular, style: .subheadline), WalkStyle.secondary)
    private let words = UIStackView()
    private let name: String

    init(name: String) {
        self.name = name
        nameLabel = WalkStyle.label(WalkStyle.font(15, .semibold, style: .subheadline), PlaudTheme.labelPrimary, name)
        super.init(frame: .zero)

        words.axis = .vertical
        words.spacing = 2
        words.addArrangedSubview(nameLabel)
        words.addArrangedSubview(stateLabel)
        words.isAccessibilityElement = true

        button.isHidden = true
        button.setContentHuggingPriority(.required, for: .horizontal)
        button.setContentCompressionResistancePriority(.required, for: .horizontal)
        button.accessibilityLabel = "Renew \(name)"

        let row = UIStackView(arrangedSubviews: [dot, words, button])
        row.axis = .horizontal
        row.alignment = .center
        row.spacing = 12
        row.translatesAutoresizingMaskIntoConstraints = false
        addSubview(row)
        NSLayoutConstraint.activate([
            row.topAnchor.constraint(equalTo: topAnchor),
            row.leadingAnchor.constraint(equalTo: leadingAnchor),
            row.trailingAnchor.constraint(equalTo: trailingAnchor),
            row.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
    }

    required init?(coder: NSCoder) { fatalError() }

    func show(_ state: String, dot color: UIColor, isProblem: Bool, offersButton: Bool = false) {
        stateLabel.text = state
        stateLabel.textColor = isProblem ? WalkStyle.problem : WalkStyle.secondary
        dot.backgroundColor = color
        if button.isHidden == offersButton { button.isHidden = !offersButton }
        words.accessibilityLabel = "\(name), \(state)"
    }
}

/// The Walk tab: start and stop a walk, see at a glance that it is recording, and read what
/// Groundwork has heard so far. How the recording is split and sent is under Details.
final class WalkViewController: UIViewController {

    private let manager = WalkCutManager.shared
    private var cancellables = Set<AnyCancellable>()
    private var ticker: Timer?
    private var logLines: [String] = []

    /// The snapshot on screen, kept so the next one can be compared with it.
    private var lastSnapshot: WalkCutManager.Snapshot?
    private var lastStatusText = ""
    private var wantsPulse = false
    private var isPulsing = false

    private var lastProgressPoll = Date.distantPast
    private var pollingWalkId: String?
    private var pollingDone = false
    private var lastProgress: WalkProgress?
    private var pollProblem: String?
    private var areasShown: [String]?
    private var recordingsShown = ""

    /// What the Plaud sign-in lines say while a renewal is under way or has failed.
    private var renewalNote: (text: String, isProblem: Bool)?
    private weak var activeField: UITextField?
    private let haptics = UINotificationFeedbackGenerator()
    private static let detailsOpenKey = "groundworkWalkDetailsOpen"

    // MARK: - Views

    private let scrollView = UIScrollView()
    private let contentStack = UIStackView()
    private let buttonBar = UIView()
    private let walkButton = PlaudTheme.makePrimaryButton(title: "Start walk")

    private let titleLabel: UILabel = {
        // The same 44pt light title as Home, Files and Settings.
        let label = WalkStyle.label(
            WalkStyle.scaled(.systemFont(ofSize: 44, weight: .light), style: .largeTitle, maximum: 60),
            .black,
            "Walk"
        )
        label.accessibilityTraits = .header
        return label
    }()

    // The recorder card.
    private let recorderCard = WalkCard(spacing: 8)
    private let statusRow = WalkStatusRow(frame: .zero)
    private let timerLabel: UILabel = {
        let label = UILabel()
        label.font = WalkStyle.scaled(.monospacedDigitSystemFont(ofSize: 56, weight: .light), style: .largeTitle, maximum: 64)
        label.adjustsFontForContentSizeCategory = true
        label.textColor = PlaudTheme.labelPrimary
        // One line, shrunk if it has to be: a clock that wraps cannot be read at a glance.
        label.numberOfLines = 1
        label.adjustsFontSizeToFitWidth = true
        label.minimumScaleFactor = 0.5
        label.isAccessibilityElement = false
        label.isHidden = true
        return label
    }()
    private let messageLabel = WalkStyle.label(WalkStyle.font(16), PlaudTheme.labelPrimary)
    private let guidanceLabel = WalkStyle.label(
        WalkStyle.font(15, .regular, style: .subheadline),
        WalkStyle.secondary,
        "Keep this screen open while you walk. If the phone locks, the recorder keeps recording and the live transcript catches up when you come back."
    )

    // Before you start.
    private let readinessCard = WalkCard(spacing: 12)
    private let recorderRow = WalkCheckRow(name: "Recorder")
    private let serverRow = WalkCheckRow(name: "Server")
    private let plaudRow = WalkCheckRow(name: "Plaud sign-in")

    // What Groundwork heard.
    /// The sections of this walk, each with its photos to take; it hides itself when there are none.
    private let guideView = WalkGuideView()
    private let heardCard = WalkCard(spacing: 8)
    private let areasStack = UIStackView()
    private let confirmLabel = WalkStyle.label(WalkStyle.font(16, .semibold), PlaudTheme.labelPrimary)
    private let transcriptLabel = WalkStyle.label(WalkStyle.font(15, .regular, style: .subheadline), WalkStyle.secondary)
    private let listeningLabel = WalkStyle.label(WalkStyle.font(16), PlaudTheme.labelPrimary)
    private let heardProblemLabel = WalkStyle.label(WalkStyle.font(15, .regular, style: .subheadline), WalkStyle.problem)
    private let openWebButton = WalkStyle.secondaryButton("Open on the web")

    // Recordings.
    private let recordingsCard = WalkCard(spacing: 12)
    private let recordingRows = UIStackView()
    private let earlierLabel = WalkStyle.label(WalkStyle.font(15, .regular, style: .subheadline), WalkStyle.secondary)
    private let sendAgainButton = WalkStyle.secondaryButton("Send again")

    // Details.
    private let detailsCard = WalkCard(spacing: 12)
    private let detailsButton = UIButton(type: .custom)
    private let detailsChevron = UIImageView(image: UIImage(systemName: "chevron.down"))
    private let detailsBody = UIStackView()
    private let lockedLabel = WalkStyle.label(
        WalkStyle.font(15, .regular, style: .subheadline),
        PlaudTheme.labelPrimary,
        "Settings are locked while a walk is recording."
    )
    private let apiField = WalkStyle.field(placeholder: "https://….trycloudflare.com", keyboard: .URL, name: "Server address")
    private let tokenField = WalkStyle.field(placeholder: "Only if the server has one", keyboard: .default, name: "Server token")
    private let cutField = WalkStyle.field(placeholder: "90", keyboard: .numberPad, name: "Seconds per recording")
    private let cutHintLabel = WalkStyle.label(WalkStyle.font(14, .regular, style: .footnote), WalkStyle.problem)
    private let plaudDetailLabel = WalkStyle.label(WalkStyle.font(15, .regular, style: .subheadline), PlaudTheme.labelPrimary)
    private let renewButton = WalkStyle.secondaryButton("Renew")
    private let timingsLabel = WalkStyle.label(WalkStyle.monospaced(12), PlaudTheme.labelPrimary)
    private let logLabel = WalkStyle.label(WalkStyle.monospaced(12), PlaudTheme.labelPrimary)

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Walk"
        // Every colour in the starter is a fixed light colour, so the page stays light too.
        overrideUserInterfaceStyle = .light
        view.backgroundColor = PlaudTheme.backgroundPrimary
        navigationController?.setNavigationBarHidden(true, animated: false)

        setupLayout()
        setupControls()
        guideView.onTakePhoto = { [weak self] section, photo in
            guard let self = self, let walkId = self.manager.snapshot.walkId else { return }
            WalkPhotos.present(
                from: self, walkId: walkId,
                sectionId: section.id, promptId: photo.id, prompt: photo.prompt
            )
        }
        loadSettings()
        setDetailsOpen(UserDefaults.standard.bool(forKey: Self.detailsOpenKey), animated: false)
        observeKeyboard()

        manager.snapshotPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] in self?.render($0) }
            .store(in: &cancellables)

        manager.logPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] in self?.appendLog($0) }
            .store(in: &cancellables)
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        renderReadiness()
        renderStatus(manager.snapshot)
        refreshPlaudTokenIfStale()
        ticker?.invalidate()
        ticker = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.tick() }
        tick()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        restartPulse()
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        view.endEditing(true)
        saveSettings()
        ticker?.invalidate()
        ticker = nil
    }

    // MARK: - Layout

    private func setupLayout() {
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        scrollView.keyboardDismissMode = .interactive
        scrollView.alwaysBounceVertical = true
        scrollView.showsVerticalScrollIndicator = false
        view.addSubview(scrollView)

        contentStack.axis = .vertical
        contentStack.spacing = 16
        contentStack.translatesAutoresizingMaskIntoConstraints = false
        scrollView.addSubview(contentStack)

        // The main button stays put above the floating tab bar, on the page background, so
        // nothing scrolls past behind it.
        buttonBar.backgroundColor = PlaudTheme.backgroundPrimary
        buttonBar.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(buttonBar)
        buttonBar.addSubview(walkButton)

        setupRecorderCard()
        setupReadinessCard()
        setupHeardCard()
        setupRecordingsCard()
        setupDetailsCard()

        [titleLabel, recorderCard, readinessCard, guideView, heardCard, recordingsCard, detailsCard]
            .forEach { contentStack.addArrangedSubview($0) }
        contentStack.setCustomSpacing(40, after: titleLabel)
        heardCard.isHidden = true
        recordingsCard.isHidden = true

        // The tab bar is 62pt tall and sits 8pt above the safe area; 12pt of air above that.
        let clearOfTabBar: CGFloat = 62 + 8 + 12

        NSLayoutConstraint.activate([
            scrollView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            scrollView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scrollView.bottomAnchor.constraint(equalTo: buttonBar.topAnchor),

            buttonBar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            buttonBar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            buttonBar.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            walkButton.topAnchor.constraint(equalTo: buttonBar.topAnchor, constant: 12),
            walkButton.leadingAnchor.constraint(equalTo: buttonBar.leadingAnchor, constant: WalkStyle.margin),
            walkButton.trailingAnchor.constraint(equalTo: buttonBar.trailingAnchor, constant: -WalkStyle.margin),
            walkButton.heightAnchor.constraint(equalToConstant: 56),
            walkButton.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -clearOfTabBar),

            contentStack.topAnchor.constraint(equalTo: scrollView.contentLayoutGuide.topAnchor, constant: 16),
            contentStack.leadingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.leadingAnchor, constant: WalkStyle.margin),
            contentStack.trailingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.trailingAnchor, constant: -WalkStyle.margin),
            // The same room at the end of the page as the neighbouring tabs leave.
            contentStack.bottomAnchor.constraint(equalTo: scrollView.contentLayoutGuide.bottomAnchor, constant: -120),
            contentStack.widthAnchor.constraint(equalTo: scrollView.frameLayoutGuide.widthAnchor, constant: -2 * WalkStyle.margin),
        ])
    }

    private func setupRecorderCard() {
        statusRow.spokenValue = { [weak self] in
            guard let self = self, let elapsed = self.manager.snapshot.elapsed(at: Date()) else { return nil }
            return WalkText.spokenDuration(elapsed)
        }
        messageLabel.isHidden = true
        recorderCard.add([statusRow, timerLabel, messageLabel, guidanceLabel])
    }

    private func setupReadinessCard() {
        readinessCard.add([WalkStyle.heading("Before you start"), recorderRow, serverRow, plaudRow])
        plaudRow.button.addTarget(self, action: #selector(renewTapped), for: .touchUpInside)
    }

    private func setupHeardCard() {
        areasStack.axis = .vertical
        areasStack.spacing = 4
        areasStack.isHidden = true
        confirmLabel.isHidden = true
        transcriptLabel.isHidden = true
        heardProblemLabel.isHidden = true
        heardCard.add([
            WalkStyle.heading("What Groundwork heard"),
            listeningLabel, areasStack, confirmLabel, transcriptLabel, heardProblemLabel, openWebButton,
        ])
        heardCard.stack.setCustomSpacing(12, after: transcriptLabel)
        heardCard.stack.setCustomSpacing(12, after: heardProblemLabel)
        openWebButton.addTarget(self, action: #selector(openWebTapped), for: .touchUpInside)
    }

    private func setupRecordingsCard() {
        recordingRows.axis = .vertical
        recordingRows.spacing = 12
        earlierLabel.isHidden = true
        sendAgainButton.isHidden = true
        recordingsCard.add([WalkStyle.heading("Recordings"), recordingRows, earlierLabel, sendAgainButton])
        sendAgainButton.addTarget(self, action: #selector(sendAgainTapped), for: .touchUpInside)
    }

    private func setupDetailsCard() {
        detailsButton.setTitle("Details", for: .normal)
        detailsButton.setTitleColor(PlaudTheme.labelPrimary, for: .normal)
        detailsButton.titleLabel?.font = WalkStyle.font(16, .semibold, style: .headline)
        detailsButton.titleLabel?.adjustsFontForContentSizeCategory = true
        detailsButton.contentHorizontalAlignment = .leading
        detailsButton.translatesAutoresizingMaskIntoConstraints = false
        detailsButton.heightAnchor.constraint(greaterThanOrEqualToConstant: WalkStyle.minimumTarget).isActive = true
        detailsButton.addTarget(self, action: #selector(detailsTapped), for: .touchUpInside)
        addPressedState(to: detailsButton)

        detailsChevron.tintColor = PlaudTheme.labelPrimary
        detailsChevron.contentMode = .scaleAspectFit
        detailsChevron.isUserInteractionEnabled = false
        detailsChevron.translatesAutoresizingMaskIntoConstraints = false
        detailsButton.addSubview(detailsChevron)
        NSLayoutConstraint.activate([
            detailsChevron.trailingAnchor.constraint(equalTo: detailsButton.trailingAnchor),
            detailsChevron.centerYAnchor.constraint(equalTo: detailsButton.centerYAnchor),
            detailsChevron.widthAnchor.constraint(equalToConstant: 20),
            detailsChevron.heightAnchor.constraint(equalToConstant: 20),
        ])

        detailsBody.axis = .vertical
        detailsBody.spacing = 8
        lockedLabel.isHidden = true
        cutHintLabel.isHidden = true
        tokenField.isSecureTextEntry = true

        let plaudName = WalkStyle.fieldName("Plaud sign-in")
        let timingsHeading = WalkStyle.heading("Timings")
        let logHeading = WalkStyle.heading("Log")
        let rows: [UIView] = [
            lockedLabel,
            WalkStyle.fieldName("Server address"), apiField,
            WalkStyle.fieldName("Server token"), tokenField,
            WalkStyle.fieldName("Seconds per recording"), cutField, cutHintLabel,
            plaudName, plaudDetailLabel, renewButton,
            timingsHeading, timingsLabel,
            logHeading, logLabel,
        ]
        rows.forEach { detailsBody.addArrangedSubview($0) }
        detailsBody.setCustomSpacing(16, after: lockedLabel)
        detailsBody.setCustomSpacing(16, after: apiField)
        detailsBody.setCustomSpacing(16, after: tokenField)
        detailsBody.setCustomSpacing(16, after: cutField)
        detailsBody.setCustomSpacing(16, after: cutHintLabel)
        detailsBody.setCustomSpacing(24, after: renewButton)
        detailsBody.setCustomSpacing(24, after: timingsLabel)
        logLabel.text = "Nothing yet."

        detailsCard.add([detailsButton, detailsBody])
        renewButton.addTarget(self, action: #selector(renewTapped), for: .touchUpInside)
    }

    private func setupControls() {
        walkButton.titleLabel?.font = WalkStyle.font(17, .semibold, style: .headline)
        walkButton.titleLabel?.adjustsFontForContentSizeCategory = true
        walkButton.titleLabel?.adjustsFontSizeToFitWidth = true
        walkButton.titleLabel?.minimumScaleFactor = 0.6
        walkButton.contentEdgeInsets = UIEdgeInsets(top: 0, left: 12, bottom: 0, right: 12)
        walkButton.addTarget(self, action: #selector(walkTapped), for: .touchUpInside)
        addPressedState(to: walkButton)

        [apiField, tokenField, cutField].forEach { $0.delegate = self }
        cutField.addTarget(self, action: #selector(cutFieldChanged), for: .editingChanged)

        // The number pad has no return key, so it gets a Done button of its own.
        let toolbar = UIToolbar(frame: CGRect(x: 0, y: 0, width: 320, height: 44))
        toolbar.items = [
            UIBarButtonItem(barButtonSystemItem: .flexibleSpace, target: nil, action: nil),
            UIBarButtonItem(title: "Done", style: .done, target: self, action: #selector(endEditing)),
        ]
        toolbar.sizeToFit()
        cutField.inputAccessoryView = toolbar

        // A tap on the page puts the keyboard away. It lets the touch through, so it never
        // takes a tap meant for a button.
        let tap = UITapGestureRecognizer(target: self, action: #selector(endEditing))
        tap.cancelsTouchesInView = false
        tap.delegate = self
        view.addGestureRecognizer(tap)

        NotificationCenter.default.addObserver(
            self, selector: #selector(appBecameActive),
            name: UIApplication.didBecomeActiveNotification, object: nil
        )
        NotificationCenter.default.addObserver(
            self, selector: #selector(reduceMotionChanged),
            name: UIAccessibility.reduceMotionStatusDidChangeNotification, object: nil
        )
    }

    private func addPressedState(to button: UIButton) {
        button.addTarget(self, action: #selector(pressBegan(_:)), for: [.touchDown, .touchDragEnter])
        button.addTarget(
            self, action: #selector(pressEnded(_:)),
            for: [.touchUpInside, .touchUpOutside, .touchCancel, .touchDragExit]
        )
    }

    @objc private func pressBegan(_ sender: UIButton) {
        sender.alpha = 0.7
    }

    @objc private func pressEnded(_ sender: UIButton) {
        sender.alpha = 1
    }

    private func setHidden(_ view: UIView, _ hidden: Bool) {
        // A stack view miscounts when a view already hidden is hidden again.
        if view.isHidden != hidden { view.isHidden = hidden }
    }

    // MARK: - Keyboard

    private func observeKeyboard() {
        NotificationCenter.default.addObserver(
            self, selector: #selector(keyboardMoved(_:)),
            name: UIResponder.keyboardWillChangeFrameNotification, object: nil
        )
        NotificationCenter.default.addObserver(
            self, selector: #selector(keyboardHid(_:)),
            name: UIResponder.keyboardWillHideNotification, object: nil
        )
    }

    @objc private func keyboardMoved(_ note: Notification) {
        guard let value = note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue else { return }
        let keyboard = view.convert(value.cgRectValue, from: nil)
        // Only the part of the keyboard that covers the scroll view counts; the button and
        // the tab bar below it are covered anyway.
        setKeyboardInset(max(0, scrollView.frame.maxY - keyboard.minY))
        showActiveField()
    }

    @objc private func keyboardHid(_ note: Notification) {
        setKeyboardInset(0)
    }

    private func setKeyboardInset(_ inset: CGFloat) {
        scrollView.contentInset.bottom = inset
        scrollView.verticalScrollIndicatorInsets.bottom = inset
    }

    private func showActiveField() {
        guard let field = activeField, field.window != nil else { return }
        view.layoutIfNeeded()
        let frame = field.convert(field.bounds, to: scrollView).insetBy(dx: 0, dy: -16)
        scrollView.scrollRectToVisible(frame, animated: true)
    }

    // MARK: - Settings

    private func loadSettings() {
        apiField.text = WalkSettings.apiURL
        tokenField.text = WalkSettings.apiToken
        cutField.text = String(WalkSettings.cutSeconds)
    }

    /// Why the seconds in the field cannot be used; nil when they can.
    private func cutProblem() -> String? {
        let entered = (cutField.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let inUse = "Walks keep using \(WalkSettings.cutSeconds) seconds until this is changed."
        guard let seconds = Int(entered) else {
            return "Enter a whole number of seconds, \(WalkSettings.minimumCutSeconds) or more. \(inUse)"
        }
        if seconds < WalkSettings.minimumCutSeconds {
            return "The shortest is \(WalkSettings.minimumCutSeconds) seconds. \(inUse)"
        }
        if seconds > WalkSettings.maximumCutSeconds {
            return "The longest is \(WalkSettings.maximumCutSeconds) seconds. \(inUse)"
        }
        return nil
    }

    private func renderCutHint() {
        let problem = cutProblem()
        cutHintLabel.text = problem
        setHidden(cutHintLabel, problem == nil)
    }

    private func saveSettings() {
        // The fields cannot be edited during a walk, and the walk keeps what it started with.
        guard !manager.snapshot.isActive else { return }
        WalkSettings.apiURL = apiField.text ?? ""
        WalkSettings.apiToken = tokenField.text ?? ""
        let entered = (cutField.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if cutProblem() == nil, let seconds = Int(entered) {
            WalkSettings.cutSeconds = seconds
        }
        renderCutHint()
        renderReadiness()
        renderStatus(manager.snapshot)
    }

    @objc private func endEditing() {
        view.endEditing(true)
        saveSettings()
    }

    @objc private func cutFieldChanged() {
        renderCutHint()
    }

    // MARK: - Actions

    @objc private func walkTapped() {
        endEditing()
        let snapshot = manager.snapshot
        switch snapshot.phase {
        case .idle:
            startTapped(snapshot)
        case .starting, .recording, .cutting:
            confirmStop()
        case .finishing:
            confirmFinish(snapshot)
        }
    }

    private func startTapped(_ snapshot: WalkCutManager.Snapshot) {
        let unsent = snapshot.sendAgainCount
        guard snapshot.finished, unsent > 0 else { return startWalk() }
        // Starting clears the last walk from this page, and with it the way to send these.
        let alert = UIAlertController(
            title: "Start a new walk?",
            message: unsent == 1
                ? "1 recording from the last walk has not been sent. A new walk takes it off this page. The audio stays on the phone, under Files."
                : "\(unsent) recordings from the last walk have not been sent. A new walk takes them off this page. The audio stays on the phone, under Files.",
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "Start new walk", style: .destructive) { [weak self] _ in
            self?.startWalk()
        })
        alert.addAction(UIAlertAction(title: "Go back", style: .cancel))
        present(alert, animated: true)
    }

    private func startWalk() {
        logLines.removeAll()
        logLabel.text = "Nothing yet."
        haptics.prepare()
        manager.startWalk()
    }

    private func confirmStop() {
        let alert = UIAlertController(title: "Stop the walk?", message: nil, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Stop walk", style: .destructive) { [weak self] _ in
            self?.manager.stopWalk()
        })
        alert.addAction(UIAlertAction(title: "Keep recording", style: .cancel))
        present(alert, animated: true)
    }

    private func confirmFinish(_ snapshot: WalkCutManager.Snapshot) {
        let onRecorder = snapshot.chunks.contains { $0.stage == .recording || $0.stage == .waitingForSync }
        let alert: UIAlertController
        if onRecorder {
            alert = UIAlertController(
                title: "Finish without the last recording?",
                message: "The audio stays on the recorder and can be synced from the Home tab later.",
                preferredStyle: .alert
            )
        } else {
            alert = UIAlertController(
                title: "Finish now?",
                message: "The recordings on their way to the server carry on being sent.",
                preferredStyle: .alert
            )
        }
        alert.addAction(UIAlertAction(title: "Finish", style: .default) { [weak self] _ in
            self?.manager.finishNow()
        })
        alert.addAction(UIAlertAction(title: "Keep waiting", style: .cancel))
        present(alert, animated: true)
    }

    @objc private func sendAgainTapped() {
        endEditing()
        pollingDone = false
        manager.retryFailed()
    }

    @objc private func openWebTapped() {
        guard let walkId = manager.snapshot.walkId, let url = WalkSettings.webURL(forWalk: walkId) else { return }
        UIApplication.shared.open(url)
    }

    @objc private func detailsTapped() {
        setDetailsOpen(detailsBody.isHidden, animated: true)
    }

    private func setDetailsOpen(_ open: Bool, animated: Bool) {
        UserDefaults.standard.set(open, forKey: Self.detailsOpenKey)
        if !open { view.endEditing(true) }
        setHidden(detailsBody, !open)
        detailsButton.accessibilityValue = open ? "Open" : "Closed"
        let turn = { self.detailsChevron.transform = open ? CGAffineTransform(rotationAngle: .pi) : .identity }
        if animated, !UIAccessibility.isReduceMotionEnabled {
            UIView.animate(withDuration: 0.2, animations: turn)
        } else {
            turn()
        }
        if open, animated {
            // Bring what has just opened onto the screen.
            view.layoutIfNeeded()
            let top = detailsCard.convert(detailsCard.bounds, to: scrollView)
            let visible = CGRect(x: top.minX, y: top.minY, width: top.width, height: min(top.height, 320))
            scrollView.scrollRectToVisible(visible, animated: true)
        }
    }

    @objc private func renewTapped() {
        endEditing()
        renewalNote = ("Asking the server for a new sign-in.", false)
        renderReadiness()
        WalkBackend.shared.refreshPlaudToken { [weak self] result in
            guard let self = self else { return }
            switch result {
            case .success:
                self.renewalNote = nil
            case .failure(let error):
                self.appendLog("Plaud token not renewed: \(error.localizedDescription)")
                let text = "\(WalkBackend.plainReason(for: error)) The Plaud sign-in was not renewed."
                self.renewalNote = (text, true)
                UIAccessibility.post(notification: .announcement, argument: text)
            }
            self.renderReadiness()
            self.renderStatus(self.manager.snapshot)
        }
    }

    /// A token that runs out mid-walk would stop the device syncing, so renew with time to spare.
    private func refreshPlaudTokenIfStale() {
        guard manager.snapshot.phase == .idle, WalkSettings.apiHost != nil,
              let expiry = WalkBackend.shared.plaudTokenExpiry,
              expiry.timeIntervalSinceNow < 4 * 3600 else { return }
        WalkBackend.shared.refreshPlaudToken { [weak self] result in
            guard let self = self else { return }
            if case .failure(let error) = result {
                self.appendLog("Plaud token not renewed: \(error.localizedDescription)")
            } else {
                self.renewalNote = nil
            }
            self.renderReadiness()
            self.renderStatus(self.manager.snapshot)
        }
    }

    private func appendLog(_ line: String) {
        logLines.append(line)
        if logLines.count > 60 { logLines.removeFirst(logLines.count - 60) }
        logLabel.text = logLines.reversed().joined(separator: "\n")
    }

    // MARK: - Rendering

    private struct Status {
        let text: String
        let dot: UIColor
        let isProblem: Bool
        let pulses: Bool
    }

    private func status(for snapshot: WalkCutManager.Snapshot) -> Status {
        let outOfRange = Status(text: "Recorder out of range", dot: WalkStyle.cautionDot, isProblem: false, pulses: false)
        switch snapshot.phase {
        case .idle:
            if snapshot.finished {
                let notSent = snapshot.notSentCount
                if notSent > 0 {
                    let text = notSent == 1
                        ? "Walk finished, 1 recording not sent"
                        : "Walk finished, \(notSent) recordings not sent"
                    return Status(text: text, dot: WalkStyle.problem, isProblem: true, pulses: false)
                }
                if snapshot.serverNotTold {
                    return Status(text: "Walk finished, server not told", dot: WalkStyle.problem, isProblem: true, pulses: false)
                }
                return Status(text: "Walk finished", dot: WalkStyle.goodDot, isProblem: false, pulses: false)
            }
            if let missing = manager.readiness.missing.first {
                let text: String
                switch missing {
                case .recorder: text = "Connect the recorder"
                case .server: text = "Enter the server address"
                case .plaudSignIn: text = "Plaud sign-in expired"
                }
                return Status(text: text, dot: WalkStyle.cautionDot, isProblem: false, pulses: false)
            }
            return Status(text: "Ready", dot: WalkStyle.neutralDot, isProblem: false, pulses: false)
        case .starting:
            guard snapshot.recorderConnected else { return outOfRange }
            return Status(text: "Starting", dot: WalkStyle.neutralDot, isProblem: false, pulses: false)
        case .recording, .cutting:
            guard snapshot.recorderConnected else { return outOfRange }
            return Status(text: "Recording", dot: WalkStyle.recordingDot, isProblem: false, pulses: true)
        case .finishing:
            guard snapshot.recorderConnected else { return outOfRange }
            return Status(text: "Finishing", dot: WalkStyle.neutralDot, isProblem: false, pulses: false)
        }
    }

    private func render(_ snapshot: WalkCutManager.Snapshot) {
        let previous = lastSnapshot
        lastSnapshot = snapshot

        let statusChanged = renderStatus(snapshot)
        renderMessage(snapshot)
        renderElapsed(snapshot)
        renderButton(snapshot)
        renderReadiness()
        renderRecordings(snapshot)
        renderDetails(snapshot)

        if snapshot.walkId != pollingWalkId {
            pollingWalkId = snapshot.walkId
            pollingDone = false
            lastProgressPoll = .distantPast
            lastProgress = nil
            pollProblem = nil
            areasShown = nil
        }
        renderHeard(snapshot)

        if let previous = previous {
            react(from: previous, to: snapshot, statusChanged: statusChanged)
        }
    }

    /// Returns true when the words have changed.
    @discardableResult
    private func renderStatus(_ snapshot: WalkCutManager.Snapshot) -> Bool {
        let status = self.status(for: snapshot)
        let changed = status.text != lastStatusText
        lastStatusText = status.text
        statusRow.label.text = status.text
        statusRow.label.textColor = status.isProblem ? WalkStyle.problem : PlaudTheme.labelPrimary
        statusRow.dot.backgroundColor = status.dot
        statusRow.accessibilityLabel = status.text
        if wantsPulse != status.pulses {
            wantsPulse = status.pulses
            updatePulse()
        }
        return changed
    }

    private func renderMessage(_ snapshot: WalkCutManager.Snapshot) {
        messageLabel.text = snapshot.message?.text
        messageLabel.textColor = snapshot.message?.kind == .problem ? WalkStyle.problem : PlaudTheme.labelPrimary
        setHidden(messageLabel, snapshot.message == nil)
        setHidden(guidanceLabel, snapshot.phase != .idle)
    }

    /// The only thing on the page that changes every second.
    private func renderElapsed(_ snapshot: WalkCutManager.Snapshot) {
        guard let elapsed = snapshot.elapsed(at: Date()) else {
            setHidden(timerLabel, true)
            return
        }
        let text = WalkText.clock(elapsed)
        if timerLabel.text != text { timerLabel.text = text }
        setHidden(timerLabel, false)
    }

    private func renderButton(_ snapshot: WalkCutManager.Snapshot) {
        switch snapshot.phase {
        case .idle:
            walkButton.setTitle("Start walk", for: .normal)
            walkButton.setTitleColor(.white, for: .normal)
            walkButton.backgroundColor = .black
            walkButton.layer.borderWidth = 0
        case .starting, .recording, .cutting:
            walkButton.setTitle("Stop walk", for: .normal)
            walkButton.setTitleColor(.white, for: .normal)
            walkButton.backgroundColor = WalkStyle.problem
            walkButton.layer.borderWidth = 0
        case .finishing:
            walkButton.setTitle("Finish without waiting", for: .normal)
            walkButton.setTitleColor(PlaudTheme.labelPrimary, for: .normal)
            walkButton.backgroundColor = .white
            walkButton.layer.borderWidth = 1
            walkButton.layer.borderColor = PlaudTheme.labelPrimary.cgColor
        }
    }

    private func renderReadiness() {
        let snapshot = manager.snapshot
        setHidden(readinessCard, snapshot.isActive)
        let readiness = manager.readiness

        if readiness.recorderConnected {
            recorderRow.show("Connected", dot: WalkStyle.goodDot, isProblem: false)
        } else {
            recorderRow.show("Not connected. Connect it on the Home tab.", dot: WalkStyle.cautionDot, isProblem: true)
        }

        if let host = readiness.serverHost {
            serverRow.show(host, dot: WalkStyle.goodDot, isProblem: false)
        } else if readiness.serverAddressEntered {
            serverRow.show("Not a web address. Correct it under Details.", dot: WalkStyle.cautionDot, isProblem: true)
        } else {
            serverRow.show("Not set. Add it under Details.", dot: WalkStyle.cautionDot, isProblem: true)
        }

        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        let plaudText: String
        let plaudIsProblem: Bool
        let plaudDot: UIColor
        var offersRenew = false
        if let note = renewalNote {
            plaudText = note.text
            plaudIsProblem = note.isProblem
            plaudDot = note.isProblem ? WalkStyle.cautionDot : WalkStyle.neutralDot
            offersRenew = note.isProblem
        } else if let expiry = readiness.plaudExpiry {
            if readiness.plaudExpired {
                plaudText = "Expired \(formatter.string(from: expiry))"
                plaudIsProblem = true
                plaudDot = WalkStyle.cautionDot
                offersRenew = true
            } else {
                plaudText = "Valid until \(formatter.string(from: expiry))"
                plaudIsProblem = false
                plaudDot = WalkStyle.goodDot
            }
        } else {
            plaudText = "Could not be read in this build"
            plaudIsProblem = true
            plaudDot = WalkStyle.cautionDot
            offersRenew = true
        }
        plaudRow.show(plaudText, dot: plaudDot, isProblem: plaudIsProblem, offersButton: offersRenew)
        plaudDetailLabel.text = plaudText
        plaudDetailLabel.textColor = plaudIsProblem ? WalkStyle.problem : PlaudTheme.labelPrimary
    }

    private func stateWords(_ stage: WalkCutManager.ChunkStage) -> String {
        switch stage {
        case .recording: return "Recording now"
        case .waitingForSync: return "Waiting for the recorder"
        case .uploading: return "Sending"
        case .sent: return "Sent"
        case .failed(let reason):
            var sentence = reason.prefix(1).uppercased() + reason.dropFirst()
            if !sentence.hasSuffix(".") { sentence += "." }
            return "Not sent. \(sentence)"
        }
    }

    private func renderRecordings(_ snapshot: WalkCutManager.Snapshot) {
        setHidden(recordingsCard, snapshot.chunks.isEmpty)
        setHidden(sendAgainButton, !snapshot.canSendAgain)

        let words = snapshot.chunks.map { stateWords($0.stage) }
        let signature = words.joined(separator: "|")
        guard signature != recordingsShown else { return }
        recordingsShown = signature
        // Something has moved on, so the server may have more to say.
        pollingDone = false

        recordingRows.arrangedSubviews.forEach { $0.removeFromSuperview() }
        let visible = 8
        let numbered = Array(snapshot.chunks.enumerated())
        for (index, chunk) in numbered.reversed().prefix(visible) {
            let name = WalkStyle.label(
                WalkStyle.font(15, .semibold, style: .subheadline),
                PlaudTheme.labelPrimary,
                "Recording \(index + 1)"
            )
            let state = WalkStyle.label(
                WalkStyle.font(15, .regular, style: .subheadline),
                chunk.isFailed ? WalkStyle.problem : WalkStyle.secondary,
                words[index]
            )
            let row = UIStackView(arrangedSubviews: [name, state])
            row.axis = .vertical
            row.spacing = 2
            row.isAccessibilityElement = true
            row.accessibilityLabel = "Recording \(index + 1), \(words[index])"
            recordingRows.addArrangedSubview(row)
        }
        let earlier = snapshot.chunks.count - visible
        earlierLabel.text = earlier > 0 ? "and \(earlier) earlier" : nil
        setHidden(earlierLabel, earlier <= 0)
    }

    private func renderDetails(_ snapshot: WalkCutManager.Snapshot) {
        let locked = snapshot.isActive
        setHidden(lockedLabel, !locked)
        [apiField, tokenField, cutField].forEach { field in
            field.isEnabled = !locked
            field.textColor = locked ? WalkStyle.secondary : PlaudTheme.labelPrimary
            field.backgroundColor = locked ? PlaudTheme.separator : .white
        }
        renewButton.isEnabled = !locked
        renewButton.alpha = locked ? 0.5 : 1
        renderTimings(snapshot)
    }

    /// What testers are asked to write down after a walk.
    private func renderTimings(_ snapshot: WalkCutManager.Snapshot) {
        var lines = ["Seconds per recording: \(snapshot.isActive || snapshot.finished ? snapshot.cutSeconds : WalkSettings.cutSeconds)"]
        if let next = snapshot.nextCutAt {
            let formatter = DateFormatter()
            formatter.dateFormat = "HH:mm:ss"
            lines.append("Next cut at \(formatter.string(from: next))")
        }
        for (index, chunk) in snapshot.chunks.enumerated().reversed() {
            var parts: [String] = []
            if let gap = chunk.gapMs { parts.append("gap before it \(gap) ms") }
            if let bytes = chunk.bytes { parts.append("\(bytes / 1024) KB") }
            if let closed = chunk.closedAt, let sent = chunk.sentAt {
                parts.append("reached the server \(Int(sent.timeIntervalSince(closed))) s after it closed")
            }
            lines.append("Recording \(index + 1): " + (parts.isEmpty ? "nothing measured yet" : parts.joined(separator: ", ")))
        }
        if let slowest = lastProgress?.slowestLatencyMs {
            lines.append("Slowest transcript: \(slowest / 1000) s after reaching the server")
        }
        let text = lines.joined(separator: "\n")
        if timingsLabel.text != text { timingsLabel.text = text }
    }

    // MARK: - What Groundwork heard

    /// The end of the transcript, starting at a whole word.
    private static func tail(of transcript: String, limit: Int = 400) -> String {
        let whole = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        guard whole.count > limit else { return whole }
        var tail = String(whole.suffix(limit))
        if let gap = tail.firstIndex(where: { $0 == " " || $0 == "\n" }) {
            tail = String(tail[tail.index(after: gap)...])
        }
        return "…" + tail.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// How long the first recording takes, in the words someone would say.
    private static func firstPartWords(_ seconds: Int) -> String {
        if seconds == 90 { return "a minute and a half" }
        if seconds % 60 == 0 {
            let minutes = seconds / 60
            return minutes == 1 ? "a minute" : "\(minutes) minutes"
        }
        if seconds > 120 { return "\(Int((Double(seconds) / 60).rounded())) minutes" }
        return "\(seconds) seconds"
    }

    /// Before there is a guide the card below says the app is listening, so the guide stays
    /// hidden until it has sections to show.
    private func renderGuide(_ snapshot: WalkCutManager.Snapshot) {
        let guide = lastProgress?.guide
        guideView.update(
            guide: guide,
            taken: lastProgress?.takenPrompts ?? [],
            isWalkActive: guide != nil && snapshot.isActive
        )
    }

    private func renderHeard(_ snapshot: WalkCutManager.Snapshot) {
        renderGuide(snapshot)
        setHidden(heardCard, snapshot.walkId == nil)
        guard snapshot.walkId != nil else { return }
        openWebButton.isEnabled = true

        let areas = lastProgress?.areaNames ?? []
        let transcript = lastProgress?.transcript.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let questions = lastProgress?.openQuestions ?? 0
        let nothingYet = areas.isEmpty && transcript.isEmpty

        if nothingYet {
            if snapshot.finished, lastProgress?.settled == true {
                listeningLabel.text = "Nothing was heard in this walk."
            } else if snapshot.finished {
                listeningLabel.text = "The server is still working through the recordings."
            } else {
                listeningLabel.text = "Listening. The first part of the walk appears here about \(Self.firstPartWords(snapshot.cutSeconds)) in."
            }
        }
        setHidden(listeningLabel, !nothingYet)

        if areasShown == nil || areasShown ?? [] != areas {
            areasShown = areas
            areasStack.arrangedSubviews.forEach { $0.removeFromSuperview() }
            for area in areas {
                areasStack.addArrangedSubview(WalkStyle.label(WalkStyle.font(16), PlaudTheme.labelPrimary, area))
            }
        }
        setHidden(areasStack, areas.isEmpty)

        confirmLabel.text = questions > 0 ? "\(questions) to confirm" : nil
        setHidden(confirmLabel, questions <= 0)

        let tail = Self.tail(of: transcript)
        if transcriptLabel.text != tail { transcriptLabel.text = tail }
        setHidden(transcriptLabel, transcript.isEmpty)

        var problems: [String] = []
        if let failed = lastProgress?.chunksFailed, failed > 0 {
            problems.append(failed == 1
                ? "1 recording could not be transcribed."
                : "\(failed) recordings could not be transcribed.")
        }
        if let pollProblem = pollProblem { problems.append(pollProblem) }
        heardProblemLabel.text = problems.joined(separator: "\n")
        setHidden(heardProblemLabel, problems.isEmpty)
    }

    // MARK: - Every second

    private func tick() {
        let snapshot = manager.snapshot
        if snapshot.isActive, let elapsed = snapshot.elapsed(at: Date()) {
            let text = WalkText.clock(elapsed)
            if timerLabel.text != text { timerLabel.text = text }
        }
        guard let walkId = snapshot.walkId, !pollingDone,
              Date().timeIntervalSince(lastProgressPoll) >= 5 else { return }
        lastProgressPoll = Date()
        WalkBackend.shared.progress(walkId: walkId) { [weak self] result in
            guard let self = self, self.pollingWalkId == walkId else { return }
            switch result {
            case .failure(let error):
                let problem = "\(WalkBackend.plainReason(for: error)) What Groundwork heard is brought up to date when the server answers."
                if self.pollProblem != problem {
                    self.appendLog("Could not ask the server about the walk: \(error.localizedDescription)")
                }
                self.pollProblem = problem
            case .success(let progress):
                if let reason = progress.failures.first, progress.chunksFailed != (self.lastProgress?.chunksFailed ?? 0) {
                    self.appendLog("The server could not transcribe a recording: \(reason)")
                }
                self.pollProblem = nil
                self.lastProgress = progress
                // Nothing more will change once a finished walk has settled.
                if progress.settled, self.manager.snapshot.phase == .idle { self.pollingDone = true }
            }
            let current = self.manager.snapshot
            self.renderHeard(current)
            self.renderTimings(current)
        }
    }

    // MARK: - Haptics, VoiceOver and the pulse

    /// Compares the snapshot with the one before it, so each thing that happens is felt and
    /// announced once, however often the page is drawn.
    private func react(
        from previous: WalkCutManager.Snapshot,
        to snapshot: WalkCutManager.Snapshot,
        statusChanged: Bool
    ) {
        let message = snapshot.message
        let messageIsNew = message != nil && message?.id != previous.message?.id
        let newProblem = messageIsNew && message?.kind == .problem
        let wentOutOfRange = previous.isActive && snapshot.isActive
            && previous.recorderConnected && !snapshot.recorderConnected
        let cameBackLate = snapshot.lateReturns > previous.lateReturns
        let startedRecording = previous.startedAt == nil && snapshot.startedAt != nil
        let finishedCleanly = !previous.finished && snapshot.finished
            && snapshot.finishedCleanly && !snapshot.chunks.isEmpty

        // One haptic for one event, the most serious first.
        if newProblem {
            haptics.notificationOccurred(.error)
        } else if wentOutOfRange || cameBackLate {
            haptics.notificationOccurred(.warning)
        } else if startedRecording || finishedCleanly {
            haptics.notificationOccurred(.success)
        }

        var spoken: [String] = []
        if statusChanged { spoken.append(lastStatusText) }
        if let message = message, newProblem || (messageIsNew && (wentOutOfRange || cameBackLate)) {
            spoken.append(message.text)
        }
        if !spoken.isEmpty {
            UIAccessibility.post(notification: .announcement, argument: spoken.joined(separator: ". "))
        }
    }

    /// The red dot fades and returns while the walk is recording, unless the user has asked
    /// for less motion.
    private func updatePulse() {
        let dot = statusRow.dot
        let shouldPulse = wantsPulse && view.window != nil && !UIAccessibility.isReduceMotionEnabled
        if shouldPulse {
            guard !isPulsing else { return }
            isPulsing = true
            dot.alpha = 1
            UIView.animate(
                withDuration: 0.8,
                delay: 0,
                options: [.autoreverse, .repeat, .curveEaseInOut, .allowUserInteraction],
                animations: { dot.alpha = 0.3 },
                completion: nil
            )
        } else {
            isPulsing = false
            dot.layer.removeAllAnimations()
            dot.alpha = 1
        }
    }

    /// Animations are dropped when the page leaves the screen, so begin again from still.
    private func restartPulse() {
        isPulsing = false
        statusRow.dot.layer.removeAllAnimations()
        statusRow.dot.alpha = 1
        updatePulse()
    }

    @objc private func appBecameActive() {
        guard isViewLoaded, view.window != nil else { return }
        restartPulse()
        renderReadiness()
        renderStatus(manager.snapshot)
    }

    @objc private func reduceMotionChanged() {
        guard isViewLoaded else { return }
        restartPulse()
    }
}

// MARK: - UITextFieldDelegate

extension WalkViewController: UITextFieldDelegate {

    func textFieldDidBeginEditing(_ textField: UITextField) {
        activeField = textField
        // The keyboard is already up when the user goes from one field to the next.
        DispatchQueue.main.async { [weak self] in self?.showActiveField() }
    }

    func textFieldDidEndEditing(_ textField: UITextField) {
        if activeField === textField { activeField = nil }
        saveSettings()
    }

    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
        textField.resignFirstResponder()
        return true
    }
}

// MARK: - UIGestureRecognizerDelegate

extension WalkViewController: UIGestureRecognizerDelegate {

    /// The tap that puts the keyboard away leaves fields and buttons alone, so a tap on the
    /// next field moves to it instead of closing the keyboard.
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        var touched = touch.view
        while let current = touched {
            if current is UIControl { return false }
            touched = current.superview
        }
        return true
    }
}
