import XCTest
@testable import NotesApp

final class SyncEngineTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_700_000_000)

    private func note(_ title: String, body: String = "", revision: Int? = 1, dirty: Bool = false, updated: TimeInterval = 0) -> Note {
        Note(title: title, body: body, updatedAt: t0.addingTimeInterval(updated), syncedRevision: revision, isDirty: dirty)
    }

    func testCleanNoteNotInFeedIsLeftAlone() throws {
        let engine = SyncEngine(transport: nil)
        let plan = try engine.plan(local: [note("A")], remote: [])
        XCTAssertTrue(plan.isEmpty)
    }

    func testNewLocalNoteIsUploaded() throws {
        let engine = SyncEngine(transport: nil)
        let fresh = note("New", revision: nil, dirty: true)
        let plan = try engine.plan(local: [fresh], remote: [])
        XCTAssertEqual(plan.upload.map(\.id), [fresh.id])
    }

    func testRemoteDeletionRemovesCleanLocalNote() throws {
        let engine = SyncEngine(transport: nil)
        let local = note("Old")
        let remote = RemoteNote(local, revision: 2, deleted: true)
        let plan = try engine.plan(local: [local], remote: [remote])
        XCTAssertEqual(plan.deleteLocally, [local.id])
    }

    func testLastWriterWinsPrefersNewerRemote() throws {
        let engine = SyncEngine(transport: nil, policy: .lastWriterWins)
        let local = note("Mine", dirty: true, updated: 10)
        var newer = local
        newer.title = "Theirs"
        newer.updatedAt = t0.addingTimeInterval(20)
        let plan = try engine.plan(local: [local], remote: [RemoteNote(newer, revision: 2)])
        XCTAssertEqual(plan.download.first?.title, "Theirs")
        XCTAssertEqual(plan.conflicts.first?.resolution, .keptRemote)
    }

    func testMergePolicyUnionsBodiesAndTags() {
        let engine = SyncEngine(transport: nil, policy: .merge)
        var local = note("List", body: "milk\neggs", dirty: true)
        local.tags = ["home"]
        var other = local
        other.body = "milk\nbread"
        other.tags = ["shopping"]
        let (merged, resolution) = engine.resolve(local: local, remote: RemoteNote(other, revision: 3))
        XCTAssertEqual(resolution, .merged)
        XCTAssertEqual(merged.body, "milk\neggs\nbread")
        XCTAssertEqual(merged.tags, ["home", "shopping"])
    }

    func testDuplicateRevisionWithDifferentPayloadThrows() {
        let engine = SyncEngine(transport: nil)
        let base = note("Dup")
        var altered = base
        altered.body = "changed"
        XCTAssertThrowsError(
            try engine.plan(local: [], remote: [RemoteNote(base, revision: 4), RemoteNote(altered, revision: 4)])
        )
    }
}
