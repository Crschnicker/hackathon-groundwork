import Foundation

/// Keeps the app's recent log lines and sends them to the Groundwork server during a walk.
///
/// The log the starter app exports is encrypted for Plaud's own support, so it cannot be read
/// here. The same lines pass through `AppLog.log`, which also hands them to `record`. When a
/// recording will not come off the recorder, this is how the reason reaches the server.
enum WalkDiagnostics {

    private static let queue = DispatchQueue(label: "com.groundwork.walk-diagnostics")
    private static let maximumLines = 3000
    private static let sendEvery: TimeInterval = 20

    private static var lines: [String] = []
    private static var walkId: String?
    private static var changed = false
    private static var timer: DispatchSourceTimer?

    private static let clock: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "HH:mm:ss.SSS"
        return formatter
    }()

    /// Called for every line the app logs.
    static func record(_ message: String) {
        let stamp = Date()
        queue.async {
            lines.append("\(clock.string(from: stamp))  \(message)")
            if lines.count > maximumLines { lines.removeFirst(lines.count - maximumLines) }
            changed = true
        }
    }

    /// Start sending the log for this walk. It carries on after the walk ends, so what happens
    /// while the last recordings are awaited is sent too, until the next walk starts.
    static func follow(walkId id: String) {
        queue.async {
            walkId = id
            changed = true
            guard timer == nil else { return }
            let source = DispatchSource.makeTimerSource(queue: queue)
            source.schedule(deadline: .now() + 2, repeating: sendEvery)
            source.setEventHandler { send() }
            timer = source
            source.resume()
        }
    }

    /// Send what there is now, without waiting for the timer.
    static func sendNow() {
        queue.async { send() }
    }

    /// Runs on `queue`.
    private static func send() {
        guard changed, let id = walkId, !lines.isEmpty else { return }
        let base = WalkSettings.apiURL
        guard !base.isEmpty, let url = URL(string: base + "/api/walks/" + id + "/log") else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 20
        request.setValue("text/plain; charset=utf-8", forHTTPHeaderField: "Content-Type")
        let token = WalkSettings.apiToken
        if !token.isEmpty { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        request.httpBody = lines.joined(separator: "\n").data(using: .utf8)
        changed = false
        URLSession.shared.dataTask(with: request) { _, response, error in
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            if error != nil || !(200..<300).contains(status) {
                // Try again at the next tick.
                queue.async { changed = true }
            }
        }.resume()
    }
}
