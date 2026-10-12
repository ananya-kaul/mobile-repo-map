import Foundation
import Combine

@MainActor
final class NotesStore: ObservableObject {
    @Published private(set) var notes: [Note] = []
    @Published private(set) var allTags: [String] = []
    @Published private(set) var isSyncing = false
    @Published var lastError: String?

    private let repository: NotesRepository
    private let api: APIClient
    private let syncEngine: SyncEngine
    private var tombstones: Set<UUID> = []

    init(
        repository: NotesRepository = NotesRepository(),
        api: APIClient = APIClient(),
        syncEngine: SyncEngine = SyncEngine()
    ) {
        self.repository = repository
        self.api = api
        self.syncEngine = syncEngine
        notes = (try? repository.loadAll()) ?? []
        rebuildTags()
    }

    var pinned: [Note] { notes.filter(\.isPinned) }
    var unpinned: [Note] { notes.filter { !$0.isPinned } }

    @discardableResult
    func create(title: String, body: String = "", tags: [String] = []) -> Note {
        let note = Note(title: title.isEmpty ? "Untitled" : title, body: body, tags: tags)
        notes.insert(note, at: 0)
        persist()
        return note
    }

    func update(_ note: Note) {
        guard let index = notes.firstIndex(where: { $0.id == note.id }) else { return }
        var copy = note
        copy.updatedAt = .now
        copy.isDirty = true
        notes[index] = copy
        persist()
    }

    func delete(_ note: Note) {
        notes.removeAll { $0.id == note.id }
        if note.syncedRevision != nil { tombstones.insert(note.id) }
        persist()
    }

    func togglePin(_ note: Note) {
        var copy = note
        copy.isPinned.toggle()
        update(copy)
    }

    func search(_ query: String) -> [Note] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return [] }
        return notes.filter {
            $0.title.lowercased().contains(q)
                || $0.body.lowercased().contains(q)
                || $0.tags.contains { $0.lowercased() == q }
        }
    }

    func refreshTags() async {
        do {
            let remote = try await api.fetchTags()
            allTags = Array(Set(remote + notes.flatMap(\.tags))).sorted()
        } catch {
            lastError = error.localizedDescription
        }
    }

    func sync() async {
        guard !isSyncing else { return }
        isSyncing = true
        defer { isSyncing = false }
        do {
            let plan = try await syncEngine.run(local: notes, deletedIDs: tombstones)
            apply(plan)
            tombstones.subtract(plan.deleteRemotely)
        } catch {
            lastError = "Sync failed: \(error.localizedDescription)"
        }
    }

    func apply(_ plan: SyncPlan) {
        var byID = Dictionary(uniqueKeysWithValues: notes.map { ($0.id, $0) })
        for id in plan.deleteLocally { byID[id] = nil }
        for note in plan.download { byID[note.id] = note }
        for var note in plan.upload {
            note.isDirty = false
            byID[note.id] = note
        }
        notes = byID.values.sorted { $0.updatedAt > $1.updatedAt }
        persist()
    }

    private func persist() {
        rebuildTags()
        do {
            try repository.saveAll(notes)
        } catch {
            lastError = "Could not save notes: \(error.localizedDescription)"
        }
    }

    private func rebuildTags() {
        allTags = Array(Set(allTags + notes.flatMap(\.tags))).sorted()
    }
}
