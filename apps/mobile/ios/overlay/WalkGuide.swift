import Foundation

/// One photo worth taking in a section of the walk guide.
struct WalkGuidePhoto: Equatable {
    /// Unique within its section, and the same for as long as the walk lasts.
    let id: String
    /// What to photograph: "The cracked concrete, close up".
    let prompt: String
    /// What the photo is for; nil when the server gave none.
    let reason: String?
}

/// A part of the property, or a topic, with the photos to take there and the things to
/// measure or ask while standing there.
struct WalkGuideSection: Equatable {

    enum Source: String {
        /// The architect talked about it.
        case heard
        /// This kind of job usually needs it, and it has not come up yet.
        case suggested
    }

    /// The same for as long as the walk lasts, so a photo can name the section it belongs to.
    let id: String
    let title: String
    let source: Source
    /// Why the job needs a suggested section; nil for one that was heard.
    let why: String?
    let photos: [WalkGuidePhoto]
    let ask: [String]
}

/// What the server suggests photographing, measuring and asking on this walk. It is written
/// again after every recording, from everything heard so far.
struct WalkGuide: Equatable {

    enum Basis: String {
        /// Written by the language model.
        case model
        /// Derived by rule from the site model, because the language model did not answer.
        case rules
    }

    /// The most the server sends. Anything beyond is left out, so the page keeps its shape.
    static let maximumSections = 12
    static let maximumPhotos = 4
    static let maximumAsks = 3

    /// "Backyard remodel". Empty when the server gave none.
    let projectType: String
    /// One sentence on what the walk is about. Empty when the server gave none.
    let headline: String
    let basis: Basis
    /// When the guide was written; nil when the server gave no time.
    let updatedAt: Date?
    /// False while there are transcripts newer than the ones the guide was written from.
    let current: Bool
    let sections: [WalkGuideSection]

    var photoCount: Int {
        sections.reduce(0) { $0 + $1.photos.count }
    }

    /// How many of the guide's photos are in `taken`, a set of keys from `promptKey`.
    func takenCount(in taken: Set<String>) -> Int {
        var count = 0
        for section in sections {
            for photo in section.photos
            where taken.contains(WalkGuide.promptKey(sectionId: section.id, promptId: photo.id)) {
                count += 1
            }
        }
        return count
    }

    // MARK: - Which photos are taken

    /// Names one photo of one section. The guide's screen and its owner both build their keys
    /// here, so they always agree on what "already taken" means.
    static func promptKey(sectionId: String, promptId: String) -> String {
        // Ids are slugs, so a slash cannot be part of either.
        sectionId + "/" + promptId
    }

    /// The photos already taken, from the value of "photos" in the walk the server returns.
    /// A photo taken without a section and a prompt answers none of the guide's, and is
    /// left out.
    static func takenKeys(fromPhotos json: Any?) -> Set<String> {
        guard let photos = json as? [Any] else { return [] }
        var keys = Set<String>()
        for entry in photos {
            guard let photo = entry as? [String: Any],
                  let sectionId = text(photo["sectionId"]),
                  let promptId = text(photo["promptId"]) else { continue }
            keys.insert(promptKey(sectionId: sectionId, promptId: promptId))
        }
        return keys
    }

    // MARK: - Reading the server's answer

    /// Reads the value of "guide" in the walk the server returns. Nil when there is no guide
    /// yet. A section that cannot be shown (no id, no title, or no photos) is left out, and
    /// anything else missing is left empty.
    static func parse(_ json: Any?) -> WalkGuide? {
        guard let guide = json as? [String: Any] else { return nil }

        let entries = guide["sections"] as? [Any] ?? []
        var sections: [WalkGuideSection] = []
        var seen = Set<String>()
        for entry in entries {
            if sections.count == maximumSections { break }
            guard let section = readSection(entry), !seen.contains(section.id) else { continue }
            seen.insert(section.id)
            sections.append(section)
        }

        return WalkGuide(
            projectType: text(guide["projectType"]) ?? "",
            headline: text(guide["headline"]) ?? "",
            basis: Basis(rawValue: text(guide["basis"]) ?? "") ?? .model,
            updatedAt: date(guide["updatedAt"]),
            current: guide["current"] as? Bool ?? true,
            sections: sections
        )
    }

    private static func readSection(_ json: Any) -> WalkGuideSection? {
        guard let section = json as? [String: Any],
              let id = text(section["id"]),
              let title = text(section["title"]) else { return nil }

        let entries = section["photos"] as? [Any] ?? []
        var photos: [WalkGuidePhoto] = []
        var seen = Set<String>()
        for entry in entries {
            if photos.count == maximumPhotos { break }
            guard let photo = entry as? [String: Any],
                  let photoId = text(photo["id"]),
                  let prompt = text(photo["prompt"]),
                  !seen.contains(photoId) else { continue }
            seen.insert(photoId)
            photos.append(WalkGuidePhoto(id: photoId, prompt: prompt, reason: text(photo["reason"])))
        }
        guard !photos.isEmpty else { return nil }

        let source = WalkGuideSection.Source(rawValue: text(section["source"]) ?? "") ?? .heard
        let asks = (section["ask"] as? [Any] ?? []).compactMap { text($0) }
        return WalkGuideSection(
            id: id,
            title: title,
            source: source,
            why: source == .suggested ? text(section["why"]) : nil,
            photos: photos,
            ask: Array(asks.prefix(maximumAsks))
        )
    }

    /// The words in a value, without the space around them; nil when it holds none.
    private static func text(_ value: Any?) -> String? {
        guard let string = value as? String else { return nil }
        let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    /// A time the server gives as milliseconds since 1970.
    private static func date(_ value: Any?) -> Date? {
        guard let number = value as? NSNumber else { return nil }
        let milliseconds = number.doubleValue
        guard milliseconds > 0 else { return nil }
        return Date(timeIntervalSince1970: milliseconds / 1000)
    }
}
