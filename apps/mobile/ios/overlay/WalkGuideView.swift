import UIKit

/// Colours, fonts and small helpers for the walk guide. The guide is read outdoors, walking,
/// with the phone in one hand, so the text is dark and the things to tap are large.
private enum WalkGuideStyle {

    /// For secondary text. 6.4:1 on white, where PlaudTheme.gray5 is about 3.7:1.
    static let secondary = UIColor(hex: "#5F5F5F")
    /// "Suggested" and "Measure or ask". 8:1 on the pale amber behind them.
    static let amberText = UIColor(hex: "#6B4703")
    static let amberBackground = UIColor(hex: "#FCF5E1")
    /// The check mark of a photo that is taken.
    static let done = UIColor(hex: "#1A4D33")
    /// Laid over a row while it is touched.
    static let pressed = UIColor(white: 0, alpha: 0.07)

    static let cardPadding: CGFloat = 16
    static let cardSpacing: CGFloat = 12
    static let minimumRow: CGFloat = 52
    static let symbolSize: CGFloat = 28

    /// Every font in the guide comes through here, so all of it follows the text size the
    /// user has chosen in Settings.
    static func font(_ size: CGFloat, _ weight: UIFont.Weight = .regular, style: UIFont.TextStyle = .body) -> UIFont {
        UIFontMetrics(forTextStyle: style).scaledFont(for: UIFont.systemFont(ofSize: size, weight: weight))
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

    static func symbol(_ name: String) -> UIImage? {
        UIImage(systemName: name, withConfiguration: UIImage.SymbolConfiguration(pointSize: 24, weight: .regular))
    }

    /// An image view of a fixed size that a touch passes through.
    static func symbolView() -> UIImageView {
        let view = UIImageView()
        view.contentMode = .center
        view.isUserInteractionEnabled = false
        view.translatesAutoresizingMaskIntoConstraints = false
        view.setContentHuggingPriority(.required, for: .horizontal)
        view.setContentCompressionResistancePriority(.required, for: .horizontal)
        // Just under required, so a stack can close the view up when it is hidden.
        let width = view.widthAnchor.constraint(equalToConstant: symbolSize)
        width.priority = UILayoutPriority(999)
        NSLayoutConstraint.activate([
            width,
            view.heightAnchor.constraint(equalToConstant: symbolSize),
        ])
        return view
    }

    static func column(spacing: CGFloat) -> UIStackView {
        let stack = UIStackView()
        stack.axis = .vertical
        stack.spacing = spacing
        return stack
    }

    /// Pins a view to the edges of the view that holds it. The holder must already hold it.
    static func pin(_ view: UIView, to holder: UIView, insets: UIEdgeInsets = .zero) {
        view.translatesAutoresizingMaskIntoConstraints = false
        // Just under required, so a stack can close the holder up when it is hidden.
        let bottom = view.bottomAnchor.constraint(equalTo: holder.bottomAnchor, constant: -insets.bottom)
        bottom.priority = UILayoutPriority(999)
        NSLayoutConstraint.activate([
            view.topAnchor.constraint(equalTo: holder.topAnchor, constant: insets.top),
            view.leadingAnchor.constraint(equalTo: holder.leadingAnchor, constant: insets.left),
            view.trailingAnchor.constraint(equalTo: holder.trailingAnchor, constant: -insets.right),
            bottom,
        ])
    }

    /// Text is set only when it differs, so an update that changes nothing touches nothing.
    static func setText(_ label: UILabel, _ text: String?) {
        if label.text != text { label.text = text }
    }

    static func setHidden(_ view: UIView, _ hidden: Bool) {
        // A stack view miscounts when a view already hidden is hidden again.
        if view.isHidden != hidden { view.isHidden = hidden }
    }

    /// A prompt as it is read after "Photo:". Its first letter drops to lower case, unless the
    /// word is written in capitals.
    static func midSentence(_ text: String) -> String {
        guard let first = text.first, first.isUppercase,
              let second = text.dropFirst().first, second.isLowercase else { return text }
        return first.lowercased() + String(text.dropFirst())
    }
}

/// One photo to take: a ring that becomes a check mark, what to photograph and what it is for,
/// and a camera. The whole row is one control.
private final class WalkGuidePhotoRow: UIControl {

    private(set) var photo: WalkGuidePhoto
    private var isTaken = false
    private var opensCamera = false

    private let line = UIView()
    private let mark = WalkGuideStyle.symbolView()
    private let camera = WalkGuideStyle.symbolView()
    private let promptLabel = WalkGuideStyle.label(WalkGuideStyle.font(17, .medium), PlaudTheme.labelPrimary)
    private let reasonLabel = WalkGuideStyle.label(
        WalkGuideStyle.font(14, .regular, style: .subheadline),
        WalkGuideStyle.secondary
    )

    init(photo: WalkGuidePhoto) {
        self.photo = photo
        super.init(frame: .zero)

        let words = WalkGuideStyle.column(spacing: 2)
        words.addArrangedSubview(promptLabel)
        words.addArrangedSubview(reasonLabel)

        let row = UIStackView(arrangedSubviews: [mark, words, camera])
        row.axis = .horizontal
        row.alignment = .center
        row.spacing = 12
        // Touches go to the row itself, wherever in it they land.
        row.isUserInteractionEnabled = false
        addSubview(row)
        WalkGuideStyle.pin(row, to: self, insets: UIEdgeInsets(
            top: 10, left: WalkGuideStyle.cardPadding, bottom: 10, right: WalkGuideStyle.cardPadding
        ))

        line.backgroundColor = PlaudTheme.separator
        line.isUserInteractionEnabled = false
        line.translatesAutoresizingMaskIntoConstraints = false
        addSubview(line)
        NSLayoutConstraint.activate([
            line.topAnchor.constraint(equalTo: topAnchor),
            line.leadingAnchor.constraint(equalTo: leadingAnchor, constant: WalkGuideStyle.cardPadding),
            line.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -WalkGuideStyle.cardPadding),
            line.heightAnchor.constraint(equalToConstant: 1),
            heightAnchor.constraint(greaterThanOrEqualToConstant: WalkGuideStyle.minimumRow),
        ])

        mark.image = WalkGuideStyle.symbol("circle")
        mark.tintColor = WalkGuideStyle.secondary
        camera.image = WalkGuideStyle.symbol("camera")
        camera.tintColor = PlaudTheme.labelPrimary
        camera.isHidden = true

        isAccessibilityElement = true
        isUserInteractionEnabled = false
        accessibilityTraits = .staticText
        accessibilityValue = "Not taken"
    }

    required init?(coder: NSCoder) { fatalError() }

    override var isHighlighted: Bool {
        didSet { backgroundColor = isHighlighted ? WalkGuideStyle.pressed : UIColor.clear }
    }

    func show(_ photo: WalkGuidePhoto, taken: Bool, opensCamera: Bool) {
        self.photo = photo
        WalkGuideStyle.setText(promptLabel, photo.prompt)
        WalkGuideStyle.setText(reasonLabel, photo.reason)
        WalkGuideStyle.setHidden(reasonLabel, photo.reason == nil)

        let label = "Photo: " + WalkGuideStyle.midSentence(photo.prompt)
        if accessibilityLabel != label { accessibilityLabel = label }

        if taken != isTaken {
            isTaken = taken
            mark.image = WalkGuideStyle.symbol(taken ? "checkmark.circle.fill" : "circle")
            mark.tintColor = taken ? WalkGuideStyle.done : WalkGuideStyle.secondary
            // A taken row reads as done, and can still be tapped for another shot.
            promptLabel.textColor = taken ? WalkGuideStyle.secondary : PlaudTheme.labelPrimary
            accessibilityValue = taken ? "Taken" : "Not taken"
        }

        if opensCamera != self.opensCamera {
            self.opensCamera = opensCamera
            isUserInteractionEnabled = opensCamera
            WalkGuideStyle.setHidden(camera, !opensCamera)
            accessibilityTraits = opensCamera ? .button : .staticText
            accessibilityHint = opensCamera ? "Opens the camera" : nil
        }
    }
}

/// The white card of one section: its title, why it is suggested, its photos, and what to
/// measure or ask there.
private final class WalkGuideSectionCard: UIView {

    private(set) var section: WalkGuideSection
    /// The group the card was put in when it appeared. It stays there, so the page does not
    /// reshuffle when a suggested section is talked about later.
    let placedAs: WalkGuideSection.Source
    var onPhotoTapped: ((WalkGuideSection, WalkGuidePhoto) -> Void)?

    private let titleLabel: UILabel = {
        let label = WalkGuideStyle.label(WalkGuideStyle.font(18, .semibold, style: .headline), PlaudTheme.labelPrimary)
        label.accessibilityTraits = .header
        return label
    }()
    private let suggestedLabel = WalkGuideStyle.label(
        WalkGuideStyle.font(13, .semibold, style: .footnote),
        WalkGuideStyle.amberText,
        "Suggested"
    )
    private let suggestedHolder = UIView()
    private let whyLabel = WalkGuideStyle.label(
        WalkGuideStyle.font(15, .regular, style: .subheadline),
        WalkGuideStyle.secondary
    )
    private let rowStack = WalkGuideStyle.column(spacing: 0)
    private var rows: [WalkGuidePhotoRow] = []
    private let askHolder = UIView()
    private let askStack = WalkGuideStyle.column(spacing: 6)
    private var askItems: [(row: UIStackView, label: UILabel)] = []

    init(section: WalkGuideSection) {
        self.section = section
        placedAs = section.source
        super.init(frame: .zero)
        backgroundColor = .white
        layer.cornerRadius = 12
        // A touched row darkens to the edge of the card, and stops at its rounded corners.
        clipsToBounds = true

        // "Suggested" sits on a pale amber patch no wider than the word.
        let pill = UIView()
        pill.backgroundColor = WalkGuideStyle.amberBackground
        pill.layer.cornerRadius = 6
        pill.translatesAutoresizingMaskIntoConstraints = false
        suggestedHolder.addSubview(pill)
        pill.addSubview(suggestedLabel)
        WalkGuideStyle.pin(suggestedLabel, to: pill, insets: UIEdgeInsets(top: 3, left: 8, bottom: 3, right: 8))
        NSLayoutConstraint.activate([
            pill.topAnchor.constraint(equalTo: suggestedHolder.topAnchor),
            pill.leadingAnchor.constraint(equalTo: suggestedHolder.leadingAnchor),
            pill.bottomAnchor.constraint(equalTo: suggestedHolder.bottomAnchor),
            pill.trailingAnchor.constraint(lessThanOrEqualTo: suggestedHolder.trailingAnchor),
        ])

        let heading = WalkGuideStyle.column(spacing: 6)
        heading.isLayoutMarginsRelativeArrangement = true
        heading.insetsLayoutMarginsFromSafeArea = false
        heading.layoutMargins = UIEdgeInsets(
            top: 0, left: WalkGuideStyle.cardPadding, bottom: 12, right: WalkGuideStyle.cardPadding
        )
        heading.addArrangedSubview(titleLabel)
        heading.addArrangedSubview(suggestedHolder)
        heading.addArrangedSubview(whyLabel)

        let askBlock = UIView()
        askBlock.backgroundColor = WalkGuideStyle.amberBackground
        askBlock.layer.cornerRadius = 8
        askHolder.addSubview(askBlock)
        WalkGuideStyle.pin(askBlock, to: askHolder, insets: UIEdgeInsets(
            top: 8, left: WalkGuideStyle.cardPadding, bottom: 8, right: WalkGuideStyle.cardPadding
        ))
        askBlock.addSubview(askStack)
        WalkGuideStyle.pin(askStack, to: askBlock, insets: UIEdgeInsets(top: 12, left: 12, bottom: 12, right: 12))
        let askHeading = WalkGuideStyle.label(
            WalkGuideStyle.font(13, .semibold, style: .footnote),
            WalkGuideStyle.amberText,
            "Measure or ask"
        )
        // Each item says it for itself, so VoiceOver does not read the heading as well.
        askHeading.isAccessibilityElement = false
        askStack.addArrangedSubview(askHeading)

        let column = WalkGuideStyle.column(spacing: 0)
        column.addArrangedSubview(heading)
        column.addArrangedSubview(rowStack)
        column.addArrangedSubview(askHolder)
        addSubview(column)
        WalkGuideStyle.pin(column, to: self, insets: UIEdgeInsets(
            top: WalkGuideStyle.cardPadding, left: 0, bottom: 8, right: 0
        ))

        suggestedHolder.isHidden = true
        whyLabel.isHidden = true
        askHolder.isHidden = true
    }

    required init?(coder: NSCoder) { fatalError() }

    /// Brings the card up to date, changing only what differs from what it shows.
    func show(_ section: WalkGuideSection, taken: Set<String>, opensCamera: Bool) {
        self.section = section
        WalkGuideStyle.setText(titleLabel, section.title)
        showSuggested(section)
        showPhotos(section, taken: taken, opensCamera: opensCamera)
        showAsks(section.ask)
    }

    private func showSuggested(_ section: WalkGuideSection) {
        let suggested = section.source == .suggested
        WalkGuideStyle.setHidden(suggestedHolder, !suggested)
        WalkGuideStyle.setText(whyLabel, section.why)
        WalkGuideStyle.setHidden(whyLabel, !suggested || section.why == nil)
        // VoiceOver reads the word and the reason as one thing.
        suggestedLabel.isAccessibilityElement = suggested && section.why == nil
        whyLabel.accessibilityLabel = section.why.map { "Suggested. \($0)" }
    }

    private func showPhotos(_ section: WalkGuideSection, taken: Set<String>, opensCamera: Bool) {
        let wanted = Set(section.photos.map { $0.id })
        var kept: [WalkGuidePhotoRow] = []
        for row in rows {
            if wanted.contains(row.photo.id) {
                kept.append(row)
            } else {
                row.removeFromSuperview()
            }
        }
        rows = kept

        // Rows keep their place; a photo that is new goes below them.
        for photo in section.photos {
            let row: WalkGuidePhotoRow
            if let existing = rows.first(where: { $0.photo.id == photo.id }) {
                row = existing
            } else {
                row = WalkGuidePhotoRow(photo: photo)
                row.addTarget(self, action: #selector(rowTapped(_:)), for: .touchUpInside)
                rowStack.addArrangedSubview(row)
                rows.append(row)
            }
            let key = WalkGuide.promptKey(sectionId: section.id, promptId: photo.id)
            row.show(photo, taken: taken.contains(key), opensCamera: opensCamera)
        }
    }

    private func showAsks(_ asks: [String]) {
        while askItems.count > asks.count {
            askItems.removeLast().row.removeFromSuperview()
        }
        for (index, ask) in asks.enumerated() {
            if index == askItems.count { addAskItem() }
            let label = askItems[index].label
            WalkGuideStyle.setText(label, ask)
            let spoken = "To measure or ask: " + WalkGuideStyle.midSentence(ask)
            if label.accessibilityLabel != spoken { label.accessibilityLabel = spoken }
        }
        WalkGuideStyle.setHidden(askHolder, asks.isEmpty)
    }

    private func addAskItem() {
        let font = WalkGuideStyle.font(15, .regular, style: .subheadline)
        let bullet = WalkGuideStyle.label(font, PlaudTheme.labelPrimary, "\u{2022}")
        bullet.isAccessibilityElement = false
        bullet.setContentHuggingPriority(.required, for: .horizontal)
        bullet.setContentCompressionResistancePriority(.required, for: .horizontal)
        let label = WalkGuideStyle.label(font, PlaudTheme.labelPrimary)
        let row = UIStackView(arrangedSubviews: [bullet, label])
        row.axis = .horizontal
        row.alignment = .firstBaseline
        row.spacing = 8
        askStack.addArrangedSubview(row)
        askItems.append((row: row, label: label))
    }

    @objc private func rowTapped(_ sender: UIControl) {
        guard let row = sender as? WalkGuidePhotoRow else { return }
        onPhotoTapped?(section, row.photo)
    }
}

/// The walk guide on the Walk tab: what kind of job this is, then a card for each section of
/// the property with the photos to take there. The server writes the guide again after every
/// recording, so the view is handed the latest every few seconds and changes only what differs.
final class WalkGuideView: UIView {

    /// Called when a photo row is tapped. While nil, the rows are not buttons and show no camera.
    var onTakePhoto: ((WalkGuideSection, WalkGuidePhoto) -> Void)? {
        didSet {
            let opensCamera = onTakePhoto != nil
            guard opensCamera != rowsOpenCamera else { return }
            rowsOpenCamera = opensCamera
            cards.forEach { $0.show($0.section, taken: shownTaken, opensCamera: opensCamera) }
        }
    }

    /// A guide that arrives sooner than this after "Listening" first showed was there before
    /// the page was, so it is shown without a haptic or an announcement.
    private static let settleSeconds: TimeInterval = 10

    private var hasShown = false
    private var shownGuide: WalkGuide?
    private var shownTaken = Set<String>()
    private var shownActive = false
    private var rowsOpenCamera = false
    /// When "Listening" came up; nil while it is not showing.
    private var listeningSince: Date?
    /// The cards in the order they are on the page.
    private var cards: [WalkGuideSectionCard] = []
    private let haptic = UIImpactFeedbackGenerator(style: .light)

    // MARK: - Views

    private let column = WalkGuideStyle.column(spacing: 16)
    private let header = WalkGuideStyle.column(spacing: 4)
    private let typeLabel: UILabel = {
        // The same 24pt light as the headers on the Files tab.
        let label = WalkGuideStyle.label(WalkGuideStyle.font(24, .light, style: .title2), PlaudTheme.labelPrimary)
        label.accessibilityTraits = .header
        return label
    }()
    private let headlineLabel = WalkGuideStyle.label(WalkGuideStyle.font(16), WalkGuideStyle.secondary)
    private let progressLabel = WalkGuideStyle.label(
        WalkGuideStyle.font(15, .semibold, style: .subheadline),
        PlaudTheme.labelPrimary
    )
    private let updatingLabel = WalkGuideStyle.label(
        WalkGuideStyle.font(15, .regular, style: .subheadline),
        WalkGuideStyle.secondary,
        "Updating with what was just said."
    )
    private let listeningCard = UIView()
    private let cardStack = WalkGuideStyle.column(spacing: WalkGuideStyle.cardSpacing)

    // MARK: - Lifecycle

    override init(frame: CGRect) {
        super.init(frame: frame)
        setupLayout()
    }

    required init?(coder: NSCoder) { fatalError() }

    private func setupLayout() {
        [typeLabel, headlineLabel, progressLabel, updatingLabel].forEach { header.addArrangedSubview($0) }
        header.setCustomSpacing(12, after: headlineLabel)

        listeningCard.backgroundColor = .white
        listeningCard.layer.cornerRadius = 12
        let listeningLabel = WalkGuideStyle.label(
            WalkGuideStyle.font(16),
            PlaudTheme.labelPrimary,
            "Listening. Sections appear here once the first part of the walk has been transcribed, about a minute and a half in."
        )
        listeningCard.addSubview(listeningLabel)
        WalkGuideStyle.pin(listeningLabel, to: listeningCard, insets: UIEdgeInsets(
            top: WalkGuideStyle.cardPadding, left: WalkGuideStyle.cardPadding,
            bottom: WalkGuideStyle.cardPadding, right: WalkGuideStyle.cardPadding
        ))

        let parts: [UIView] = [header, listeningCard, cardStack]
        parts.forEach { column.addArrangedSubview($0) }
        addSubview(column)
        WalkGuideStyle.pin(column, to: self)

        // Nothing to show until the first update says otherwise.
        header.isHidden = true
        listeningCard.isHidden = true
        cardStack.isHidden = true
        isHidden = true
    }

    // MARK: - Updating

    /// Shows the latest from the server. `taken` holds a key from WalkGuide.promptKey for every
    /// photo already taken. Most calls change nothing, and then nothing on the page is touched.
    func update(guide: WalkGuide?, taken: Set<String>, isWalkActive: Bool) {
        // A guide with no sections has nothing to walk through yet.
        let latest: WalkGuide? = (guide?.sections.isEmpty ?? true) ? nil : guide
        if hasShown, taken == shownTaken, isWalkActive == shownActive, showsSame(latest, shownGuide) { return }
        hasShown = true
        shownGuide = latest
        shownTaken = taken
        shownActive = isWalkActive

        guard let guide = latest else {
            showNoGuide(isWalkActive: isWalkActive)
            return
        }

        let listenedFor = listeningSince.map { Date().timeIntervalSince($0) } ?? 0
        listeningSince = nil
        // New sections are made known when they join a guide already on the page, or follow
        // a wait under "Listening". A guide that was there before the page was, or one that
        // replaces another walk's, is shown quietly.
        let known = Set(cards.map { $0.section.id })
        let makesKnown: Bool
        if cards.isEmpty {
            makesKnown = listenedFor >= Self.settleSeconds
        } else {
            makesKnown = guide.sections.contains { known.contains($0.id) }
        }

        showHeader(guide, taken: taken)
        WalkGuideStyle.setHidden(listeningCard, true)
        WalkGuideStyle.setHidden(header, false)
        WalkGuideStyle.setHidden(cardStack, false)
        WalkGuideStyle.setHidden(self, false)

        let added = showSections(guide.sections, taken: taken)
        guard makesKnown, !added.isEmpty, window != nil else { return }
        announce(added)
    }

    /// Whether two guides put the same things on the page. When each was written is not shown.
    private func showsSame(_ one: WalkGuide?, _ other: WalkGuide?) -> Bool {
        guard let one = one, let other = other else { return one == nil && other == nil }
        return one.projectType == other.projectType
            && one.headline == other.headline
            && one.current == other.current
            && one.sections == other.sections
    }

    private func showNoGuide(isWalkActive: Bool) {
        cards.forEach { $0.removeFromSuperview() }
        cards.removeAll()
        WalkGuideStyle.setHidden(header, true)
        WalkGuideStyle.setHidden(cardStack, true)
        WalkGuideStyle.setHidden(listeningCard, !isWalkActive)
        if !isWalkActive {
            listeningSince = nil
        } else if listeningSince == nil {
            listeningSince = Date()
        }
        // With no walk there is nothing to say, and the stack this view is in closes up.
        WalkGuideStyle.setHidden(self, !isWalkActive)
    }

    private func showHeader(_ guide: WalkGuide, taken: Set<String>) {
        WalkGuideStyle.setText(typeLabel, guide.projectType)
        WalkGuideStyle.setHidden(typeLabel, guide.projectType.isEmpty)
        WalkGuideStyle.setText(headlineLabel, guide.headline)
        WalkGuideStyle.setHidden(headlineLabel, guide.headline.isEmpty)

        let total = guide.photoCount
        let done = guide.takenCount(in: taken)
        WalkGuideStyle.setText(progressLabel, "\(done) of \(total) \(total == 1 ? "photo" : "photos") taken")
        WalkGuideStyle.setHidden(updatingLabel, guide.current)
    }

    /// Returns the cards that were not on the page before.
    private func showSections(_ sections: [WalkGuideSection], taken: Set<String>) -> [WalkGuideSectionCard] {
        let wanted = Set(sections.map { $0.id })
        var kept: [WalkGuideSectionCard] = []
        for card in cards {
            if wanted.contains(card.section.id) {
                kept.append(card)
            } else {
                card.removeFromSuperview()
            }
        }
        cards = kept

        var added: [WalkGuideSectionCard] = []
        for section in sections {
            if let card = cards.first(where: { $0.section.id == section.id }) {
                card.show(section, taken: taken, opensCamera: rowsOpenCamera)
                continue
            }
            let card = WalkGuideSectionCard(section: section)
            card.onPhotoTapped = { [weak self] section, photo in
                self?.onTakePhoto?(section, photo)
            }
            card.show(section, taken: taken, opensCamera: rowsOpenCamera)

            // Heard sections come first. A new one goes to the end of its own group, so
            // nothing above it moves.
            var index = cards.count
            if section.source == .heard {
                if let lastHeard = cards.lastIndex(where: { $0.placedAs == .heard }) {
                    index = lastHeard + 1
                } else {
                    index = 0
                }
            }
            cards.insert(card, at: index)
            cardStack.insertArrangedSubview(card, at: index)
            added.append(card)
        }
        return added
    }

    /// One fade, one haptic and one announcement for the update, however many sections came.
    private func announce(_ added: [WalkGuideSectionCard]) {
        if !UIAccessibility.isReduceMotionEnabled {
            added.forEach { $0.alpha = 0 }
            UIView.animate(
                withDuration: 0.25,
                delay: 0,
                options: [.allowUserInteraction],
                animations: { added.forEach { $0.alpha = 1 } },
                completion: nil
            )
        }
        haptic.impactOccurred()
        let words = added.count == 1
            ? "New section: \(added[0].section.title)"
            : "\(added.count) new sections"
        UIAccessibility.post(notification: .announcement, argument: words)
    }
}
