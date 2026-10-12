import SwiftUI

struct NoteEditorScreen: View {
    @EnvironmentObject private var store: NotesStore
    @Environment(\.dismiss) private var dismiss
    @State private var title: String
    @State private var bodyText: String
    @FocusState private var bodyFocused: Bool
    private let original: Note?

    init(note: Note?) {
        original = note
        _title = State(initialValue: note?.title ?? "")
        _bodyText = State(initialValue: note?.body ?? "")
    }

    private var hasChanges: Bool {
        title != (original?.title ?? "") || bodyText != (original?.body ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                TextField("Title", text: $title)
                    .font(.title3.weight(.semibold))
                    .submitLabel(.next)
                    .onSubmit { bodyFocused = true }
                TextEditor(text: $bodyText)
                    .frame(minHeight: 240)
                    .focused($bodyFocused)
            }
            .navigationTitle(original == nil ? "New note" : "Edit note")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", action: save)
                        .disabled(!hasChanges || (title.isEmpty && bodyText.isEmpty))
                }
            }
            .interactiveDismissDisabled(hasChanges)
        }
    }

    private func save() {
        if var note = original {
            note.title = title
            note.body = bodyText
            store.update(note)
        } else {
            store.create(title: title, body: bodyText)
        }
        dismiss()
    }
}
