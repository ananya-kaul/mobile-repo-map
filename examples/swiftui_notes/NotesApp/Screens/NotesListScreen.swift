import SwiftUI

struct NotesListScreen: View {
    @EnvironmentObject private var store: NotesStore
    @State private var path: [Note] = []
    @State private var isCreating = false
    @State private var isScanning = false

    var body: some View {
        NavigationStack(path: $path) {
            Group {
                if store.notes.isEmpty {
                    EmptyStateView(
                        systemImage: "square.and.pencil",
                        title: "No notes yet",
                        message: "Tap + to write your first note."
                    )
                } else {
                    List {
                        if !store.pinned.isEmpty {
                            Section("Pinned") {
                                ForEach(store.pinned) { note in
                                    NavigationLink(value: note) {
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(note.title).font(.headline)
                                            Text(note.preview).font(.subheadline).foregroundStyle(.secondary)
                                        }
                                    }
                                }
                            }
                        }
                        Section("All notes") {
                            ForEach(store.unpinned) { note in
                                NavigationLink(value: note) {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(note.title).font(.headline)
                                        Text(note.preview).font(.subheadline).foregroundStyle(.secondary)
                                    }
                                }
                                .swipeActions {
                                    Button(role: .destructive) { store.delete(note) } label: {
                                        Label("Delete", systemImage: "trash")
                                    }
                                }
                            }
                        }
                    }
                    .refreshable { await store.sync() }
                }
            }
            .navigationTitle("Notes")
            .navigationDestination(for: Note.self) { note in
                NoteDetailScreen(note: note)
            }
            .toolbar {
                ToolbarItemGroup(placement: .primaryAction) {
                    Button { isScanning = true } label: {
                        Image(systemName: "doc.viewfinder")
                    }
                    Button { isCreating = true } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .sheet(isPresented: $isCreating) {
                NoteEditorScreen(note: nil)
            }
            .sheet(isPresented: $isScanning) {
                ScannerView { text in
                    let note = store.create(title: "Scanned note", body: text)
                    path.append(note)
                }
                .ignoresSafeArea()
            }
        }
    }
}
