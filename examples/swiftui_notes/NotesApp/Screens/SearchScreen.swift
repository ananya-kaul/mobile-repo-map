import SwiftUI

struct SearchScreen: View {
    @EnvironmentObject private var store: NotesStore
    @State private var query = ""

    private var results: [Note] { store.search(query) }

    var body: some View {
        NavigationStack {
            Group {
                if query.isEmpty {
                    EmptyStateView(
                        systemImage: "magnifyingglass",
                        title: "Search notes",
                        message: "Titles, text and tags are all searchable."
                    )
                } else if results.isEmpty {
                    EmptyStateView(
                        systemImage: "questionmark.folder",
                        title: "No results",
                        message: "Nothing matches “\(query)”."
                    )
                } else {
                    List(results) { note in
                        NoteRow(note: note)
                    }
                }
            }
            .navigationTitle("Search")
            .searchable(text: $query, prompt: "Search notes")
        }
    }
}
