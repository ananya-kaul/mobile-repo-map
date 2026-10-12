import SwiftUI

struct RootTabView: View {
    @EnvironmentObject private var store: NotesStore
    @Environment(SettingsModel.self) private var settings
    @AppStorage("hasCompletedOnboarding") private var hasCompletedOnboarding = false
    @State private var showOnboarding = false

    var body: some View {
        TabView {
            NotesListScreen()
                .tabItem { Label("Notes", systemImage: "note.text") }
            SearchScreen()
                .tabItem { Label("Search", systemImage: "magnifyingglass") }
            SettingsScreen()
                .tabItem { Label("Settings", systemImage: "gearshape") }
        }
        .fullScreenCover(isPresented: $showOnboarding) {
            OnboardingScreen {
                hasCompletedOnboarding = true
                showOnboarding = false
            }
        }
        .onAppear { showOnboarding = !hasCompletedOnboarding }
        .task {
            if settings.syncOnLaunch {
                await store.sync()
            }
        }
    }
}
