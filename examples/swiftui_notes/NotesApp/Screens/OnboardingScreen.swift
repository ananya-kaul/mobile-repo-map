import SwiftUI

struct OnboardingScreen: View {
    var onFinish: () -> Void
    @State private var page = 0

    private let pages: [(icon: String, title: String, text: String)] = [
        ("note.text", "Capture ideas", "Write notes in seconds and pin the ones that matter."),
        ("tag", "Stay organised", "Tag notes and find anything with instant search."),
        ("arrow.triangle.2.circlepath", "Everywhere", "Notes sync quietly across all your devices."),
    ]

    var body: some View {
        VStack {
            TabView(selection: $page) {
                ForEach(pages.indices, id: \.self) { index in
                    VStack(spacing: 16) {
                        Image(systemName: pages[index].icon)
                            .font(.system(size: 64))
                            .foregroundStyle(.tint)
                        Text(pages[index].title).font(.title.bold())
                        Text(pages[index].text)
                            .multilineTextAlignment(.center)
                            .foregroundStyle(.secondary)
                    }
                    .padding(32)
                    .tag(index)
                }
            }
            .tabViewStyle(.page)
            .indexViewStyle(.page(backgroundDisplayMode: .always))

            Button {
                if page < pages.count - 1 {
                    withAnimation { page += 1 }
                } else {
                    onFinish()
                }
            } label: {
                Text(page < pages.count - 1 ? "Next" : "Get started")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .padding()
        }
    }
}
