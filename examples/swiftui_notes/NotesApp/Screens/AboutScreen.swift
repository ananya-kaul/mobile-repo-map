import SwiftUI

struct AboutScreen: View {
    private var version: String {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String ?? "1.0"
        let build = info?["CFBundleVersion"] as? String ?? "1"
        return "\(short) (\(build))"
    }

    var body: some View {
        List {
            Section {
                LabeledContent("Version", value: version)
            }
            Section("Links") {
                Link("Website", destination: URL(string: "https://notesapp.dev")!)
                Link("Privacy policy", destination: URL(string: "https://notesapp.dev/privacy")!)
                Link("Contact support", destination: URL(string: "mailto:support@notesapp.dev")!)
            }
            Section("Acknowledgements") {
                Text("Alamofire — MIT License")
            }
        }
        .navigationTitle("About")
    }
}
