import SwiftUI

struct TagPickerScreen: View {
    @EnvironmentObject private var store: NotesStore
    @Binding var selection: Set<String>
    @State private var newTag = ""

    var body: some View {
        List {
            Section {
                HStack {
                    TextField("New tag", text: $newTag)
                        .textInputAutocapitalization(.never)
                        .onSubmit(addTag)
                    Button("Add", action: addTag)
                        .disabled(newTag.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            Section("Tags") {
                ForEach(store.allTags, id: \.self) { tag in
                    Button {
                        if selection.contains(tag) {
                            selection.remove(tag)
                        } else {
                            selection.insert(tag)
                        }
                    } label: {
                        HStack {
                            TagChip(name: tag)
                            Spacer()
                            if selection.contains(tag) {
                                Image(systemName: "checkmark")
                            }
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .navigationTitle("Tags")
        .task { await store.refreshTags() }
    }

    private func addTag() {
        let tag = newTag.trimmingCharacters(in: .whitespaces).lowercased()
        guard !tag.isEmpty else { return }
        selection.insert(tag)
        newTag = ""
    }
}
