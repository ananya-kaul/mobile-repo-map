import Foundation
import Alamofire

struct SyncPayload: Encodable {
    let since: Date?
    let upserts: [RemoteNote]
    let deletions: [UUID]
}

struct SyncResponse: Decodable {
    let changes: [RemoteNote]
    let serverTime: Date
}

protocol SyncTransport {
    func exchange(_ payload: SyncPayload) async throws -> SyncResponse
}

final class AlamofireSyncTransport: SyncTransport {
    private let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        return e
    }()

    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()

    func exchange(_ payload: SyncPayload) async throws -> SyncResponse {
        try await AF.request("https://api.notesapp.dev/v1/sync", method: .post, parameters: payload, encoder: JSONParameterEncoder(encoder: encoder))
            .validate(statusCode: 200..<300)
            .serializingDecodable(SyncResponse.self, decoder: decoder)
            .value
    }
}
