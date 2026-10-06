import SwiftUI

/// Versions, the host, and what the phone deliberately leaves to the mac.
struct AboutView: View {
    @Environment(AppModel.self) private var model
    @State private var daemon: SettingsLoad<DaemonInfo> = .loading

    var body: some View {
        SettingsPage(title: String(localized: "about"), refresh: { await load() }) {
            if let info = daemon.value, info.stale { StaleDaemonNotice(info: info) }
            VStack(spacing: 0) {
                SettingsInfoRow(key: String(localized: "app"), value: SettingsFormat.appVersion)
                SettingsDivider()
                SettingsInfoRow(key: String(localized: "bridge"), value: model.client.hello.map { "v\($0.roveVersion)" } ?? "—")
                SettingsDivider()
                SettingsInfoRow(key: String(localized: "daemon"), value: daemonVersion)
                SettingsDivider()
                SettingsInfoRow(key: String(localized: "host"), value: model.client.hello?.host ?? "—")
                SettingsDivider()
                SettingsInfoRow(key: String(localized: "uptime"), value: uptime)
                SettingsDivider()
                SettingsInfoRow(key: String(localized: "tasks"), value: daemon.value?.taskCount.map(String.init) ?? "—")
            }
            .tile()
            if case .failed(let message) = daemon { ErrorLine(text: message) }
            Hint(text: String(localized: "language follows ios settings → rove"))
            Hint(text: String(localized: "restarting the daemon, resetting ui state and plugin installs are mac-side actions — the phone talks to the daemon through the bridge and has no way back if it goes down"))
        }
        .task { await load() }
    }

    private var daemonVersion: String {
        switch daemon {
        case .loading: "…"
        case .failed: "—"
        case .loaded(let info): info.daemonVersion.map { "v\($0)" } ?? "—"
        }
    }

    private var uptime: String {
        guard let ms = daemon.value?.uptimeMs else { return "—" }
        return InsightLogic.duration(ms: ms)
    }

    private func load() async {
        do {
            daemon = .loaded(try await model.client.request("daemon.info", as: DaemonInfo.self))
        } catch {
            daemon = .failed(error.localizedDescription)
        }
    }
}
