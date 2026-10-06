import SwiftUI

private struct PluginSwitch: Identifiable {
    var id: String
    var enabled: Bool
}

/// Installed plugins (`plugins.list`) with an on/off switch. Installing stays on the mac.
struct PluginsView: View {
    @Environment(AppModel.self) private var model
    @State private var state: SettingsLoad<PluginsPayload> = .loading
    @State private var reloadError: String?
    @State private var pending: PluginSwitch?

    var body: some View {
        SettingsPage(title: "plugins", refresh: { await load() }) {
            switch state {
            case .loading:
                BrailleSpinner(size: 14)
            case .failed(let message):
                ErrorLine(text: message)
            case .loaded(let payload):
                if let reloadError { ErrorLine(text: reloadError) }
                if payload.plugins.isEmpty {
                    EmptyState(title: "no plugins", detail: "none are installed on the mac")
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(payload.plugins.enumerated()), id: \.element.id) { index, plugin in
                            if index > 0 { SettingsDivider() }
                            PluginRow(plugin: plugin) { pending = PluginSwitch(id: plugin.id, enabled: !plugin.enabled) }
                        }
                    }
                    .tile()
                }
                Hint(text: "installing and configuring plugins runs their own commands, so it stays on the mac (rove plugin …)")
            }
        }
        .task { await load() }
        .sheet(item: $pending) { change in
            SettingsConfirmSheet(title: change.enabled ? "switch on \(change.id)?" : "switch off \(change.id)?",
                         kicker: "plugin", prose: prose(change),
                         label: change.enabled ? "switch on" : "switch off", run: {
                _ = try await model.client.request("plugin.setEnabled", ["id": change.id, "enabled": change.enabled],
                                                   as: EmptyResult.self)
                await load()
            }, failed: { await load() })
        }
    }

    private func prose(_ change: PluginSwitch) -> String {
        change.enabled
            ? "Switches \(change.id) on: its actions and events run again on the mac."
            : "Switches \(change.id) off: its actions and events stop running on the mac. It stays installed."
    }

    private func load() async {
        do {
            state = .loaded(try await model.client.request("plugins.list", as: PluginsPayload.self))
            reloadError = nil
        } catch {
            if state.value == nil { state = .failed(error.localizedDescription) } else { reloadError = error.localizedDescription }
        }
    }
}

private struct PluginRow: View {
    var plugin: PluginInfo
    var toggle: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 5) {
                Text(plugin.id).font(Theme.mono(14, .medium)).foregroundStyle(plugin.enabled ? Theme.ink : Theme.muted)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                tagLine.font(Theme.mono(11)).fixedSize(horizontal: false, vertical: true)
                if let run = plugin.lastRun {
                    Text(lastRun(run)).font(Theme.mono(12)).foregroundStyle(Theme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let declares = declares() {
                    Text(declares).font(Theme.mono(12)).foregroundStyle(Theme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 8)
            Button(action: toggle) {
                Text(plugin.enabled ? "switch off" : "switch on").font(Theme.mono(12, .medium))
                    .foregroundStyle(Theme.ink).padding(.horizontal, 10).frame(minHeight: 36).tile()
            }
            .buttonStyle(.pressable)
            .accessibilityIdentifier("pluginToggle-\(plugin.id)")
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("pluginRow-\(plugin.id)")
    }

    /// `v1.2.0  on  linked  update available`: one wrapping line, each word in its own tone.
    private var tagLine: Text {
        var tags: [(String, Color)] = []
        if !plugin.version.isEmpty { tags.append(("v\(plugin.version)", Theme.muted)) }
        tags.append((plugin.enabled ? "on" : "off", plugin.enabled ? Theme.success : Theme.muted))
        if plugin.linked { tags.append(("linked", Theme.muted)) }
        if plugin.updateAvailable { tags.append(("update available", Theme.accent)) }
        if !plugin.platformOk { tags.append(("platform unsupported", Theme.warning)) }
        return tags.reduce(Text("")) { line, tag in line + Text(tag.0 + "  ").foregroundStyle(tag.1) }
    }

    private func lastRun(_ run: PluginLastRun) -> String {
        let result = run.running ? "running" : run.ok ? "ok" : "failed"
        let age = SettingsFormat.age(since: run.at)
        return ["last run", run.label, result, age.isEmpty ? nil : "\(age) ago"].compactMap { $0 }.joined(separator: " ")
    }

    private func declares() -> String? {
        guard let d = plugin.declares else { return nil }
        let parts = [("action", d.actions), ("event", d.events), ("pane", d.panes), ("engine", d.engines)]
            .filter { $0.1 > 0 }
            .map { "\($0.1) \($0.0)\($0.1 == 1 ? "" : "s")" }
        return parts.isEmpty ? "declares nothing" : "declares: " + parts.joined(separator: " · ")
    }
}
