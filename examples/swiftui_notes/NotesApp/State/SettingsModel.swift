import Foundation
import Observation

@Observable
final class SettingsModel {
    enum SortOrder: String, CaseIterable, Identifiable {
        case updated, created, title
        var id: String { rawValue }
    }

    var sortOrder: SortOrder {
        didSet { defaults.set(sortOrder.rawValue, forKey: Keys.sortOrder) }
    }
    var syncOnLaunch: Bool {
        didSet { defaults.set(syncOnLaunch, forKey: Keys.syncOnLaunch) }
    }
    var isPro: Bool {
        didSet { defaults.set(isPro, forKey: Keys.isPro) }
    }

    @ObservationIgnored private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        sortOrder = SortOrder(rawValue: defaults.string(forKey: Keys.sortOrder) ?? "") ?? .updated
        syncOnLaunch = defaults.object(forKey: Keys.syncOnLaunch) as? Bool ?? true
        isPro = defaults.bool(forKey: Keys.isPro)
    }

    private enum Keys {
        static let sortOrder = "settings.sortOrder"
        static let syncOnLaunch = "settings.syncOnLaunch"
        static let isPro = "settings.isPro"
    }
}
