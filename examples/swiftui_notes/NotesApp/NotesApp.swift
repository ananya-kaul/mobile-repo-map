import SwiftUI

@main
struct NotesApp: App {
    @StateObject private var store = NotesStore()
    @State private var settings = SettingsModel()

    var body: some Scene {
        WindowGroup {
            RootTabView()
                .environmentObject(store)
                .environment(settings)
        }
    }
}
