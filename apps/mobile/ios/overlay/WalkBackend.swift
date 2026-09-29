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
            return url
        }
        set { UserDefaults.standard.set(newValue, forKey: Keys.apiURL) }
    }

    static var apiToken: String {
        get { stored(Keys.apiToken) ?? plist("GroundworkApiToken") }
        set { UserDefaults.standard.set(newValue, forKey: Keys.apiToken) }
    }

    static var cutSeconds: Int {
        get {
            let saved = UserDefaults.standard.integer(forKey: Keys.cutSeconds)
            let value = saved > 0 ? saved : (Int(plist("GroundworkCutSeconds")) ?? defaultCutSeconds)
            return max(minimumCutSeconds, value)
        }
        set { UserDefaults.standard.set(newValue, forKey: Keys.cutSeconds) }
    }
}

enum WalkBackendError: LocalizedError {
    case notConfigured
    case badResponse(Int, String)
    case unreadable(String)

    var errorDescription: String? {
        switch self {
        case .notConfigured:
            return "Enter the Groundwork API address first."
        case .badResponse(let status, let body):
            return "Server answered \(status): \(body)"
        case .unreadable(let what):
            return "Could not read \(what) from the server's answer."
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
    private init() {}

    private let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 60
        config.timeoutIntervalForResource = 300
        config.waitsForConnectivity = true
        return URLSession(configuration: config)
    }()

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
            session.uploadTask(with: req, fromFile: file, completionHandler: handler).resume()
        } else {
            var req = req
            req.httpBody = body
            session.dataTask(with: req, completionHandler: handler).resume()
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
            completion(.failure(WalkBackendError.unreadable("the user in the current Plaud token")))
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
}
