import SwiftUI

/// List row that links straight to the note. Used by search results.
struct NoteRow: View {
    let note: Note

    var body: some View {
        NavigationLink {
            NoteDetailScreen(note: note)
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    if note.isPinned {
                        Image(systemName: "pin.fill")
                            .font(.caption)
                            .foregroundStyle(.orange)
                    }
                    Text(note.title)
                        .font(.headline)
                        .lineLimit(1)
                }
                if !note.preview.isEmpty {
                    Text(note.preview)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
                if !note.tags.isEmpty {
                    HStack {
                        ForEach(note.tags.prefix(3), id: \.self) { tag in
                            TagChip(name: tag)
                        }
                    }
                }
            }
            .padding(.vertical, 2)
        }
    }
}
