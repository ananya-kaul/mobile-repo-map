import SwiftUI

struct NoteDetailScreen: View {
    @EnvironmentObject private var store: NotesStore
    @State private var isEditing = false
    @State private var selectedTags: Set<String>
    let note: Note

    init(note: Note) {
        self.note = note
        _selectedTags = State(initialValue: Set(note.tags))
    }

    private var current: Note {
        store.notes.first { $0.id == note.id } ?? note
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(current.body.isEmpty ? "Empty note" : current.body)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)

                if !current.tags.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack {
                            ForEach(current.tags, id: \.self) { tag in
                                TagChip(name: tag)
                            }
                        }
                    }
                }

                NavigationLink {
                    TagPickerScreen(selection: $selectedTags)
                } label: {
                    Label("Edit tags", systemImage: "tag")
                }

                Text("Edited \(current.updatedAt.formatted(.relative(presentation: .named)))")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .padding()
        }
        .navigationTitle(current.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup {
                Button { store.togglePin(current) } label: {
                    Image(systemName: current.isPinned ? "pin.slash" : "pin")
                }
                Button("Edit") { isEditing = true }
            }
        }
        .sheet(isPresented: $isEditing) {
            NoteEditorScreen(note: current)
        }
        .onChange(of: selectedTags) { _, tags in
            var updated = current
            updated.tags = tags.sorted()
            store.update(updated)
        }
    }
}
