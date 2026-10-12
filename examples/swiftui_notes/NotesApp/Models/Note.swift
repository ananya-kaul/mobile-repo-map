import Foundation

struct Note: Identifiable, Hashable, Codable {
    let id: UUID
    var title: String
    var body: String
    var tags: [String]
    var isPinned: Bool
    let createdAt: Date
    var updatedAt: Date
    /// Server revision this note was last reconciled against; nil = never synced.
    var syncedRevision: Int?
    var isDirty: Bool

    init(
        id: UUID = UUID(),
        title: String,
        body: String = "",
        tags: [String] = [],
        isPinned: Bool = false,
        createdAt: Date = .now,
        updatedAt: Date = .now,
        syncedRevision: Int? = nil,
        isDirty: Bool = true
    ) {
        self.id = id
        self.title = title
        self.body = body
        self.tags = tags
        self.isPinned = isPinned
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.syncedRevision = syncedRevision
        self.isDirty = isDirty
    }

    var preview: String {
        let firstLine = body.split(separator: "\n", omittingEmptySubsequences: true).first ?? ""
        return firstLine.count > 80 ? String(firstLine.prefix(80)) + "…" : String(firstLine)
    }
}

/// Wire format used by the sync API.
struct RemoteNote: Codable, Equatable {
    let id: UUID
    var title: String
    var body: String
    var tags: [String]
    var isPinned: Bool
    var updatedAt: Date
    var revision: Int
    var deleted: Bool

    init(_ note: Note, revision: Int, deleted: Bool = false) {
        id = note.id
        title = note.title
        body = note.body
        tags = note.tags
        isPinned = note.isPinned
        updatedAt = note.updatedAt
        self.revision = revision
        self.deleted = deleted
    }

    func asNote(createdAt: Date) -> Note {
        Note(
            id: id, title: title, body: body, tags: tags, isPinned: isPinned,
            createdAt: createdAt, updatedAt: updatedAt, syncedRevision: revision, isDirty: false
        )
    }
}
