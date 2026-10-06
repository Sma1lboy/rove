import Foundation

/// The in-app notification switch (Settings → notifications). Local to this phone: the Notifier
/// reads it before posting, so turning it off silences banners without touching the Mac.
enum NotificationPrefs {
    static let key = "notifications.enabled"

    /// On by default; only a stored `false` turns it off.
    static var enabled: Bool {
        get { enabled(in: .standard) }
        set { UserDefaults.standard.set(newValue, forKey: key) }
    }

    static func enabled(in defaults: UserDefaults) -> Bool {
        defaults.object(forKey: key) as? Bool ?? true
    }
}
