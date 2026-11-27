import UIKit

/// The app's taps: the shell's own buttons, and rove-web's through `window.webkit.messageHandlers.haptic`.
@MainActor
enum Haptic {
    static func play(_ kind: String = "light") {
        switch kind {
        case "success": UINotificationFeedbackGenerator().notificationOccurred(.success)
        case "warning": UINotificationFeedbackGenerator().notificationOccurred(.warning)
        case "medium": UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        default: UIImpactFeedbackGenerator(style: .light).impactOccurred()
        }
    }
}
