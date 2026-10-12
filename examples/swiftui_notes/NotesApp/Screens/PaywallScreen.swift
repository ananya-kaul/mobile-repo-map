import SwiftUI

struct PaywallScreen: View {
    @Environment(SettingsModel.self) private var settings
    @Environment(\.dismiss) private var dismiss
    @State private var plan: Plan = .yearly
    @State private var isPurchasing = false

    enum Plan: String, CaseIterable, Identifiable {
        case monthly, yearly
        var id: String { rawValue }

        var price: String {
            switch self {
            case .monthly: return "$2.99 / month"
            case .yearly: return "$19.99 / year"
            }
        }
    }

    var body: some View {
        VStack(spacing: 24) {
            HStack {
                Spacer()
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark.circle.fill").font(.title2)
                }
                .accessibilityLabel("Close")
            }

            Image(systemName: "sparkles")
                .font(.system(size: 56))
                .foregroundStyle(.tint)
            Text("Notes Pro").font(.largeTitle.bold())
            VStack(alignment: .leading, spacing: 8) {
                Label("Unlimited sync across devices", systemImage: "icloud")
                Label("Document scanning with text recognition", systemImage: "doc.viewfinder")
                Label("Custom tag colours", systemImage: "tag")
            }

            Picker("Plan", selection: $plan) {
                ForEach(Plan.allCases) { plan in
                    Text(plan.price).tag(plan)
                }
            }
            .pickerStyle(.segmented)

            Button {
                purchase()
            } label: {
                Text(isPurchasing ? "Purchasing…" : "Continue")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(isPurchasing)

            Spacer()
        }
        .padding()
    }

    private func purchase() {
        isPurchasing = true
        // StoreKit purchase elided in the fixture; unlock immediately.
        settings.isPro = true
        isPurchasing = false
        dismiss()
    }
}
