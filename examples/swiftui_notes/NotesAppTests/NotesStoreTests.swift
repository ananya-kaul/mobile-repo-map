import XCTest
@testable import NotesApp

@MainActor
final class NotesStoreTests: XCTestCase {
    private var directory: URL!
    private var store: NotesStore!

    override func setUp() async throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        store = NotesStore(
            repository: NotesRepository(directory: directory),
            syncEngine: SyncEngine(transport: nil)
        )
    }

    override func tearDown() async throws {
        try? FileManager.default.removeItem(at: directory)
    }

    func testCreateInsertsAtTopAndPersists() throws {
        store.create(title: "First")
        store.create(title: "Second", body: "hello")

        XCTAssertEqual(store.notes.map(\.title), ["Second", "First"])
        let reloaded = try NotesRepository(directory: directory).loadAll()
        XCTAssertEqual(reloaded.count, 2)
    }

    func testEmptyTitleBecomesUntitled() {
        let note = store.create(title: "")
        XCTAssertEqual(note.title, "Untitled")
    }

    func testTogglePinMovesNoteToPinnedSection() {
        let note = store.create(title: "Groceries")
        store.togglePin(note)
        XCTAssertEqual(store.pinned.map(\.id), [note.id])
        XCTAssertTrue(store.unpinned.isEmpty)
    }

    func testSearchMatchesTitleBodyAndTags() {
        store.create(title: "Trip", body: "Book the train", tags: ["travel"])
        store.create(title: "Recipe", body: "Pasta")

        XCTAssertEqual(store.search("train").count, 1)
        XCTAssertEqual(store.search("TRAVEL").count, 1)
        XCTAssertTrue(store.search("   ").isEmpty)
    }

    func testSyncWithoutTransportReportsError() async {
        store.create(title: "Offline")
        await store.sync()
        XCTAssertNotNil(store.lastError)
        XCTAssertFalse(store.isSyncing)
    }
}
