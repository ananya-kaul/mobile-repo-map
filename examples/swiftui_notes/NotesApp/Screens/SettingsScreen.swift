import SwiftUI

struct SettingsScreen: View {
    @Environment(SettingsModel.self) private var settings
    @EnvironmentObject private var store: NotesStore
    @State private var showPaywall = false

    var body: some View {
        @Bindable var settings = settings
        NavigationStack {
            Form {
                Section("Notes") {
                    Picker("Sort by", selection: $settings.sortOrder) {
                        ForEach(SettingsModel.SortOrder.allCases) { order in
                            Text(order.rawValue.capitalized).tag(order)
                        }
                    }
                    Toggle("Sync on launch", isOn: $settings.syncOnLaunch)
                    Button {
                        Task { await store.sync() }
                    } label: {
                        HStack {
                            Text("Sync now")
                            if store.isSyncing {
                                ProgressView()
                            }
                        }
                    }
                    .disabled(store.isSyncing)
                }

                Section("Subscription") {
                    if settings.isPro {
                        Label("Notes Pro is active", systemImage: "checkmark.seal.fill")
                    } else {
                        Button("Upgrade to Notes Pro") { showPaywall = true }
                    }
                }

                Section {
                    NavigationLink(destination: AboutScreen()) {
                        Text("About")
                    }
                }
            }
            .navigationTitle("Settings")
            .fullScreenCover(isPresented: $showPaywall) {
                PaywallScreen()
            }
        }
    }
}
