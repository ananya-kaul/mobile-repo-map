import SwiftUI

struct TagChip: View {
    let name: String

    private var tint: Color {
        let palette: [Color] = [.blue, .green, .orange, .pink, .purple, .teal]
        let index = abs(name.unicodeScalars.reduce(0) { $0 &+ Int($1.value) }) % palette.count
        return palette[index]
    }

    var body: some View {
        Text("#\(name)")
            .font(.caption.weight(.medium))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(tint.opacity(0.15), in: Capsule())
            .foregroundStyle(tint)
    }
}
