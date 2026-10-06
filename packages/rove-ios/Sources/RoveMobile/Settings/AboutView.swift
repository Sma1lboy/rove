import SwiftUI

/// Versions, the host, and what the phone deliberately leaves to the mac.
struct AboutView: View {
    @Environment(AppModel.self) private var model
    @State private var daemon: SettingsLoad<DaemonInfo> = .loading

    var body: some View {
        SettingsPage(title: "about", refresh: { await load() }) {
            if let info = daemon.value, info.stale { StaleDaemonNotice(info: info) }
            VStack(spacing: 0) {
                SettingsInfoRow(key: "app", value: SettingsFormat.appVersion)
                SettingsDivider()
                SettingsInfoRow(key: "bridge", value: model.client.hello.map { "v\($0.roveVersion)" } ?? "—")
                SettingsDivider()
                SettingsInfoRow(key: "daemon", value: daemonVersion)
                SettingsDivider()
                SettingsInfoRow(key: "host", value: model.client.hello?.host ?? "—")
                SettingsDivider()
                SettingsInfoRow(key: "uptime", value: uptime)
                SettingsDivider()
                SettingsInfoRow(key: "tasks", value: daemon.value?.taskCount.map(String.init) ?? "—")
            }
            .tile()
            if case .failed(let message) = daemon { ErrorLine(text: message) }
            Hint(text: "language follows ios settings → rove")
            Hint(text: "restarting the daemon, resetting ui state and plugin installs are mac-side actions — the phone talks to the daemon through the bridge and has no way back if it goes down")
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
