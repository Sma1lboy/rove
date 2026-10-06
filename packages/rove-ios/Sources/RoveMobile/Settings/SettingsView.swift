import SwiftUI

/// Local navigation inside Settings; `Route` is closed, so sub-screens push through
/// `.navigationDestination(item:)` on the home view.
enum SettingsRoute: Hashable {
    case bridge, usage, engines, plugins, notifications, activity, feedback, about
}

/// One home row: mono title, mono muted detail on the right.
private struct SettingsRow: View {
    var title: String
    var detail: String = ""
    var detailTint: Color = Theme.muted
    var identifier: String
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Text(title).font(Theme.mono(14, .medium)).foregroundStyle(Theme.ink)
                Spacer()
                if !detail.isEmpty {
                    Text(detail).font(Theme.mono(12)).foregroundStyle(detailTint).lineLimit(1)
                }
                Text("›").font(Theme.mono(14)).foregroundStyle(Theme.muted)
            }
            .padding(.horizontal, 14)
            .frame(minHeight: 48)
        }
        .buttonStyle(RowButtonStyle())
        .accessibilityIdentifier(identifier)
    }
}

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var route: SettingsRoute?
    @State private var usage: UsagePayload?
    @State private var daemon: DaemonInfo?
    @State private var engines: EnginesSettingsPayload?
    @State private var plugins: PluginsPayload?
    @State private var notificationsOn = NotificationPrefs.enabled

    var body: some View {
        VStack(spacing: 0) {
            ScreenHeader(back: { dismiss() }) {
                Text("settings").font(Theme.face(16, .semibold)).foregroundStyle(Theme.ink)
                    .accessibilityAddTraits(.isHeader)
            } trailing: { EmptyView() }
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    if let daemon, daemon.stale { StaleDaemonNotice(info: daemon) }
                    VStack(spacing: 0) {
                        SettingsRow(title: String(localized: "bridge"), detail: model.client.state.label.lowercased(),
                                    identifier: "settingsRow-bridge") { route = .bridge }
                        SettingsDivider()
                        SettingsRow(title: String(localized: "usage"), detail: usageDetail.text, detailTint: usageDetail.tint,
                                    identifier: "settingsRow-usage") { route = .usage }
                        SettingsDivider()
                        SettingsRow(title: String(localized: "engines"), detail: enginesDetail,
                                    identifier: "settingsRow-engines") { route = .engines }
                        SettingsDivider()
                        SettingsRow(title: String(localized: "plugins"), detail: pluginsDetail,
                                    identifier: "settingsRow-plugins") { route = .plugins }
                        SettingsDivider()
                        SettingsRow(title: String(localized: "notifications"),
                                    detail: notificationsOn ? String(localized: "on") : String(localized: "off"),
                                    identifier: "settingsRow-notifications") { route = .notifications }
                        SettingsDivider()
                        SettingsRow(title: String(localized: "worktrees"), identifier: "settingsRow-worktrees") {
                            model.path.append(.worktrees)
                        }
                        SettingsDivider()
                        SettingsRow(title: String(localized: "activity"), identifier: "settingsRow-activity") { route = .activity }
                        SettingsDivider()
                        SettingsRow(title: String(localized: "feedback"), identifier: "settingsRow-feedback") { route = .feedback }
                        SettingsDivider()
                        SettingsRow(title: String(localized: "about"), detail: SettingsFormat.appVersion,
                                    identifier: "settingsRow-about") { route = .about }
                    }
                    .tile()
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }
            .refreshable { await load() }
        }
        .background(Theme.paper.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .navigationDestination(item: $route) { route in
            switch route {
            case .bridge: PairingView()
            case .usage: UsageView()
            case .engines: EnginesView()
            case .plugins: PluginsView()
            case .notifications: NotificationsView()
            case .activity: ActivityView()
            case .feedback: FeedbackView()
            case .about: AboutView()
            }
        }
        .task { await load() }
        .onAppear { notificationsOn = NotificationPrefs.enabled }
        .onChange(of: route) { _, _ in
            notificationsOn = NotificationPrefs.enabled
            Task { await load() }
        }
    }

    // MARK: Row details

    private var usageDetail: (text: String, tint: Color) {
        var best: (name: String, percent: Int)?
        for vendor in usage?.usage ?? [] {
            guard let w = UsageLogic.worst(vendor) else { continue }
            if best == nil || w.percent > best!.percent { best = (vendor.displayName.lowercased(), w.percent) }
        }
        guard let best else { return ("—", Theme.muted) }
        return ("\(best.name) \(best.percent)%", UsageTone.of(percent: best.percent).color)
    }

    private var enginesDetail: String {
        guard let engines else { return "—" }
        return String(localized: "\(engines.engines.filter(\.enabled).count) of \(engines.engines.count) on")
    }

    private var pluginsDetail: String {
        guard let plugins else { return "—" }
        return String(localized: "\(plugins.plugins.filter(\.enabled).count) on")
    }

    /// All four summaries in parallel; each one that fails leaves its row at `—`.
    private func load() async {
        async let u = try? await model.client.request("usage.get", as: UsagePayload.self)
        async let d = try? await model.client.request("daemon.info", as: DaemonInfo.self)
        async let e = try? await model.client.request("engines.settings", as: EnginesSettingsPayload.self)
        async let p = try? await model.client.request("plugins.list", as: PluginsPayload.self)
        let (uu, dd, ee, pp) = await (u, d, e, p)
        usage = uu
        daemon = dd
        engines = ee
        plugins = pp
    }
}
