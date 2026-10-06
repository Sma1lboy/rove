import SwiftUI
import UIKit
import UserNotifications

/// The in-app banner switch plus the iOS permission it depends on.
struct NotificationsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase
    @State private var enabled = NotificationPrefs.enabled
    @State private var authorization: UNAuthorizationStatus?

    var body: some View {
        SettingsPage(title: "notifications") {
            FormSection(label: "banners") {
                ChoiceTiles(options: [true, false], selection: Binding(
                    get: { enabled },
                    set: { enabled = $0; NotificationPrefs.enabled = $0 }
                ), label: { $0 ? "on" : "off" })
                .accessibilityIdentifier("notificationsToggle")
                Hint(text: "banners when a task needs you or finishes. only on this phone.")
            }
            if authorization == .denied {
                permissionTile(text: "ios notifications are off for rove", action: "open ios settings") {
                    if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                }
            } else if authorization == .notDetermined {
                permissionTile(text: "ios has not asked about notifications yet", action: "allow") {
                    model.notifier.requestPermission()
                }
            }
        }
        .task { await refresh() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await refresh() } }
        }
    }

    private func permissionTile(text: String, action: String, perform: @escaping () -> Void) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(text).font(Theme.mono(13, .bold)).foregroundStyle(Theme.warning)
            Button(action: perform) {
                TileLabel(text: action)
            }
            .buttonStyle(.pressable)
            .accessibilityIdentifier("notificationsPermission")
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .tile(Theme.warning.opacity(0.10), border: Theme.warning)
    }

    private func refresh() async {
        authorization = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }
}
