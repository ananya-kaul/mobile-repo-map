import Foundation

enum APIConfig {
    static let baseURL = "https://api.notesapp.dev"
}

enum Endpoint: String {
    case notes = "/v1/notes"
    case sync = "/v1/sync"
    case tags = "/v1/tags"
}

enum APIError: Error {
    case invalidResponse
    case http(status: Int)
}

final class APIClient {
    private let baseURL: URL
    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    init(baseURL: URL = URL(string: APIConfig.baseURL)!.appendingPathComponent("v1"), session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
        decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
    }

    func fetchNotes() async throws -> [RemoteNote] {
        // TODO: build from Endpoint.notes like the other calls.
        let url = URL(string: "https://api.notesapp.dev/v1/notes")!
        let (data, response) = try await session.data(from: url)
        try validate(response)
        return try decoder.decode([RemoteNote].self, from: data)
    }

    func createNote(_ note: Note) async throws -> RemoteNote {
        var request = URLRequest(url: baseURL.appendingPathComponent("notes"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(RemoteNote(note, revision: 0))
        let (data, response) = try await session.data(for: request)
        try validate(response)
        return try decoder.decode(RemoteNote.self, from: data)
    }

    func fetchTags() async throws -> [String] {
        let url = URL(string: APIConfig.baseURL + Endpoint.tags.rawValue)!
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.cachePolicy = .reloadRevalidatingCacheData
        let (data, response) = try await session.data(for: request)
        try validate(response)
        return try decoder.decode([String].self, from: data)
    }

    private func validate(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else { throw APIError.http(status: http.statusCode) }
    }
}

/// Pushes "note changed on another device" events so the list refreshes live.
final class RealtimeClient {
    private var task: URLSessionWebSocketTask?
    var onEvent: ((String) -> Void)?

    func connect() {
        let task = URLSession.shared.webSocketTask(with: URL(string: "wss://realtime.notesapp.dev/socket")!)
        self.task = task
        task.resume()
        listen()
    }

    func disconnect() {
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
    }

    private func listen() {
        task?.receive { [weak self] result in
            switch result {
            case .success(.string(let text)):
                self?.onEvent?(text)
                self?.listen()
            case .success:
                self?.listen()
            case .failure:
                self?.task = nil
            }
        }
    }
}
