import Foundation
import PlaudDeviceBasicSDK

/// Where the walk recorder sends its chunks. Build-time values come from Info.plist
/// (GitHub Actions fills them in); the Walk tab can override them, which matters because a
/// tunnel URL changes every time the tunnel restarts.
enum WalkSettings {
    private enum Keys {
        static let apiURL = "groundworkApiURL"
        static let apiToken = "groundworkApiToken"
        static let cutSeconds = "groundworkCutSeconds"
    }

    static let defaultCutSeconds = 90
    static let minimumCutSeconds = 15
    /// The server refuses a walk that asks for anything longer.
    static let maximumCutSeconds = 3600

    private static func plist(_ key: String) -> String {
        let value = (Bundle.main.object(forInfoDictionaryKey: key) as? String) ?? ""
        // An unset build setting reaches Info.plist as the literal "$(NAME)".
        return value.hasPrefix("$(") ? "" : value.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func stored(_ key: String) -> String? {
        guard let value = UserDefaults.standard.string(forKey: key)?
            .trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return nil }
        return value
    }

    /// Origin only, e.g. https://example.trycloudflare.com — no trailing slash, no /api.
    static var apiURL: String {
        get {
            var url = stored(Keys.apiURL) ?? plist("GroundworkApiURL")
            while url.hasSuffix("/") { url.removeLast() }
            if url.hasSuffix("/api") { url.removeLast(4) }
            // A bare host name typed into the field means the tunnel, which is https.
            if !url.isEmpty, !url.contains("://") { url = "https://" + url }
            return url
        }
        set { UserDefaults.standard.set(newValue, forKey: Keys.apiURL) }
    }

    /// The host name in the address; nil when no address is set or it is not a web address.
    static var apiHost: String? {
        guard let components = URLComponents(string: apiURL),
              let scheme = components.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = components.host, !host.isEmpty else { return nil }
        return host
    }

    /// The walk's page in the web app. Only right when the address is the web app's own
    /// (the tunnel or the web address), because the API port serves no pages.
    static func webURL(forWalk walkId: String) -> URL? {
        guard apiHost != nil else { return nil }
        return URL(string: apiURL + "/walks/" + walkId)
    }

    static var apiToken: String {
        get { stored(Keys.apiToken) ?? plist("GroundworkApiToken") }
        set { UserDefaults.standard.set(newValue, forKey: Keys.apiToken) }
    }

    static var cutSeconds: Int {
        get {
            let saved = UserDefaults.standard.integer(forKey: Keys.cutSeconds)
            let value = saved > 0 ? saved : (Int(plist("GroundworkCutSeconds")) ?? defaultCutSeconds)
            return min(maximumCutSeconds, max(minimumCutSeconds, value))
        }
        set { UserDefaults.standard.set(newValue, forKey: Keys.cutSeconds) }
    }
}

enum WalkBackendError: LocalizedError {
    case notConfigured
    case badResponse(Int, String)
    case unreadable(String)
    /// The Plaud token in use names no user, so the server cannot be asked for a new one.
    case noPlaudUser

    var errorDescription: String? {
        switch self {
        case .notConfigured:
            return "Enter the Groundwork API address first."
        case .badResponse(let status, let body):
            return "Server answered \(status): \(body)"
        case .unreadable(let what):
            return "Could not read \(what) from the server's answer."
        case .noPlaudUser:
            return "Could not read the user in the current Plaud token."
        }
    }
}

/// What the server has made of the walk so far.
struct WalkProgress {
    let chunksTotal: Int
    let chunksDone: Int
    let chunksFailed: Int
    let settled: Bool
    let transcript: String
    let areaNames: [String]
    let openQuestions: Int
    let slowestLatencyMs: Int?
    let failures: [String]
}

/// The few Groundwork API calls the recorder needs.
final class WalkBackend {

    static let shared = WalkBackend()

    /// Called on the main queue when a recording is being held back because the phone has no
    /// connection. The recording is sent by itself once the connection returns.
    var onWaitingForConnection: (() -> Void)?

    private final class UploadWatcher: NSObject, URLSessionTaskDelegate {
        var waiting: (() -> Void)?

        func urlSession(_ session: URLSession, taskIsWaitingForConnectivity task: URLSessionTask) {
            DispatchQueue.main.async { [weak self] in self?.waiting?() }
        }
    }

    private let uploadWatcher = UploadWatcher()

    /// Short calls. They fail quickly, so the screen can say what is wrong instead of waiting.
    private let quickSession: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 20
        config.timeoutIntervalForResource = 40
        config.waitsForConnectivity = false
        return URLSession(configuration: config)
    }()

    /// Recordings. A walk passes through places with no signal, so these wait for the
    /// connection to come back before giving up.
    private lazy var uploadSession: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 60
        config.timeoutIntervalForResource = 300
        config.waitsForConnectivity = true
        return URLSession(configuration: config, delegate: self.uploadWatcher, delegateQueue: nil)
    }()

    private init() {
        uploadWatcher.waiting = { [weak self] in self?.onWaitingForConnection?() }
    }

    private func request(_ method: String, _ path: String, query: [URLQueryItem] = []) throws -> URLRequest {
        let base = WalkSettings.apiURL
        guard !base.isEmpty, var components = URLComponents(string: base + "/api" + path) else {
            throw WalkBackendError.notConfigured
        }
        if !query.isEmpty { components.queryItems = query }
        guard let url = components.url else { throw WalkBackendError.notConfigured }
        var req = URLRequest(url: url)
        req.httpMethod = method
        let token = WalkSettings.apiToken
        if !token.isEmpty { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        return req
    }

    private func send(
        _ req: URLRequest,
        body: Data? = nil,
        file: URL? = nil,
        completion: @escaping (Result<[String: Any], Error>) -> Void
    ) {
        let handler: (Data?, URLResponse?, Error?) -> Void = { data, response, error in
            let result: Result<[String: Any], Error>
            if let error = error {
                result = .failure(error)
            } else {
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                let data = data ?? Data()
                let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
                if (200..<300).contains(status), let json = json {
                    result = .success(json)
                } else {
                    let text = (json?["error"] as? String) ?? String(data: data.prefix(300), encoding: .utf8) ?? ""
                    result = .failure(WalkBackendError.badResponse(status, text))
                }
            }
            DispatchQueue.main.async { completion(result) }
        }
        if let file = file {
            uploadSession.uploadTask(with: req, fromFile: file, completionHandler: handler).resume()
        } else {
            var req = req
            req.httpBody = body
            quickSession.dataTask(with: req, completionHandler: handler).resume()
        }
    }

    // MARK: - Walks

    func createWalk(userId: String, cutSeconds: Int, completion: @escaping (Result<String, Error>) -> Void) {
        do {
            var req = try request("POST", "/walks")
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            let body = try JSONSerialization.data(withJSONObject: ["userId": userId, "cutSeconds": cutSeconds])
            send(req, body: body) { result in
                completion(result.flatMap { json in
                    guard let id = json["id"] as? String else { return .failure(WalkBackendError.unreadable("the walk id")) }
                    return .success(id)
                })
            }
        } catch {
            completion(.failure(error))
        }
    }

    /// `sessionId` is the device's id for the recording: the epoch second it started.
    func sendChunk(
        walkId: String,
        sessionId: Int,
        gapMs: Int?,
        file: URL,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        do {
            var query = [
                URLQueryItem(name: "key", value: String(sessionId)),
                URLQueryItem(name: "startedAt", value: String(sessionId)),
                URLQueryItem(name: "filetype", value: "mp3"),
            ]
            if let gapMs = gapMs { query.append(URLQueryItem(name: "gapMs", value: String(gapMs))) }
            var req = try request("POST", "/walks/\(walkId)/chunks", query: query)
            req.setValue("audio/mpeg", forHTTPHeaderField: "Content-Type")
            send(req, file: file) { completion($0.map { _ in () }) }
        } catch {
            completion(.failure(error))
        }
    }

    func finishWalk(walkId: String, completion: @escaping (Result<Void, Error>) -> Void) {
        do {
            send(try request("POST", "/walks/\(walkId)/finish")) { completion($0.map { _ in () }) }
        } catch {
            completion(.failure(error))
        }
    }

    func progress(walkId: String, completion: @escaping (Result<WalkProgress, Error>) -> Void) {
        do {
            send(try request("GET", "/walks/\(walkId)")) { result in
                completion(result.map { json in
                    let counts = json["counts"] as? [String: Any] ?? [:]
                    let chunks = json["chunks"] as? [[String: Any]] ?? []
                    let model = json["siteModel"] as? [String: Any]
                    let areas = model?["areas"] as? [[String: Any]] ?? []
                    return WalkProgress(
                        chunksTotal: counts["total"] as? Int ?? 0,
                        chunksDone: counts["done"] as? Int ?? 0,
                        chunksFailed: counts["failed"] as? Int ?? 0,
                        settled: json["settled"] as? Bool ?? false,
                        transcript: json["transcript"] as? String ?? "",
                        areaNames: areas.compactMap { $0["name"] as? String },
                        openQuestions: (model?["missing"] as? [Any])?.count ?? 0,
                        slowestLatencyMs: chunks.compactMap { $0["latencyMs"] as? Int }.max(),
                        failures: chunks.compactMap { $0["error"] as? String }
                    )
                })
            }
        } catch {
            completion(.failure(error))
        }
    }

    // MARK: - Plaud token

    /// Plaud user tokens last 24 hours at most, so the one built into the app goes stale within
    /// a day. This fetches a fresh one for the same user and hands it to the SDK.
    func refreshPlaudToken(completion: @escaping (Result<Date, Error>) -> Void) {
        guard let current = JwtUtils.parse(DeviceManager.shared.userAccessToken) else {
            completion(.failure(WalkBackendError.noPlaudUser))
            return
        }
        do {
            var req = try request("POST", "/plaud/user-token")
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            let body = try JSONSerialization.data(withJSONObject: ["userId": current.userId])
            send(req, body: body) { result in
                completion(result.flatMap { json in
                    guard let token = json["accessToken"] as? String, let info = JwtUtils.parse(token) else {
                        return .failure(WalkBackendError.unreadable("the new Plaud token"))
                    }
                    UserDefaults.standard.set(token, forKey: "userAccessTokenOverride")
                    PlaudDeviceAgent.shared.setUserAccessToken(token)
                    return .success(Date(timeIntervalSince1970: info.expSeconds))
                })
            }
        } catch {
            completion(.failure(error))
        }
    }

    /// When the Plaud token in use stops working; nil if it cannot be read.
    var plaudTokenExpiry: Date? {
        guard let info = JwtUtils.parse(DeviceManager.shared.userAccessToken), info.expSeconds > 0 else { return nil }
        return Date(timeIntervalSince1970: info.expSeconds)
    }

    // MARK: - Plain words for failures

    /// What went wrong, as one plain sentence for the screen. It says what happened; the caller
    /// adds what that means for the walk. The raw error text belongs in the log.
    static func plainReason(for error: Error) -> String {
        if let backendError = error as? WalkBackendError {
            switch backendError {
            case .notConfigured:
                return "The server address is not set, or is not a web address."
            case .noPlaudUser:
                return "This build has no Plaud sign-in that can be read."
            case .unreadable:
                return "The server's answer could not be read. The address may belong to something other than Groundwork."
            case .badResponse(let status, let body):
                if status == 503, body.contains("Plaud") {
                    return "The server is missing its Plaud keys, so it cannot transcribe."
                }
                switch status {
                case 200...299:
                    return "The server's answer could not be read. The address may belong to something other than Groundwork."
                case 401, 403:
                    return "The server did not accept the server token."
                case 404:
                    return "The server did not find what was asked for. The server address may be wrong."
                case 413:
                    return "The recording is too large for the server."
                case 502, 503, 504, 530:
                    return "Nothing is answering behind the server address."
                case 500...599:
                    return "The server had a problem of its own."
                default:
                    return "The server did not accept the request."
                }
            }
        }
        let nsError = error as NSError
        guard nsError.domain == NSURLErrorDomain else { return "The server could not be reached." }
        switch nsError.code {
        case NSURLErrorNotConnectedToInternet, NSURLErrorNetworkConnectionLost, NSURLErrorDataNotAllowed,
             NSURLErrorInternationalRoamingOff, NSURLErrorCallIsActive:
            return "The phone has no connection to the internet."
        case NSURLErrorTimedOut:
            return "The server took too long to answer."
        case NSURLErrorCannotFindHost, NSURLErrorDNSLookupFailed, NSURLErrorCannotConnectToHost:
            return "Nothing answers at the server address. If the tunnel was restarted, its address has changed."
        case NSURLErrorSecureConnectionFailed, NSURLErrorServerCertificateUntrusted,
             NSURLErrorServerCertificateHasBadDate, NSURLErrorServerCertificateNotYetValid,
             NSURLErrorServerCertificateHasUnknownRoot, NSURLErrorAppTransportSecurityRequiresSecureConnection:
            return "A secure connection to the server could not be made. The address should start with https."
        case NSURLErrorBadURL, NSURLErrorUnsupportedURL:
            return "The server address is not a web address."
        default:
            return "The server could not be reached."
        }
    }

    /// False when sending the same thing again cannot succeed until a setting is changed.
    static func isWorthRetrying(_ error: Error) -> Bool {
        if let backendError = error as? WalkBackendError {
            switch backendError {
            case .notConfigured, .unreadable, .noPlaudUser:
                return false
            case .badResponse(let status, _):
                return status == 408 || status == 429 || status >= 500
            }
        }
        let nsError = error as NSError
        if nsError.domain == NSURLErrorDomain {
            return nsError.code != NSURLErrorBadURL && nsError.code != NSURLErrorUnsupportedURL
        }
        return true
    }
}
