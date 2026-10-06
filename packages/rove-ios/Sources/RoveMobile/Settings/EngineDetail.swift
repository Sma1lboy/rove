import SwiftUI

/// One engine write, with the prose that says exactly what it changes. Every one is destructive in the bridge.
private enum EngineAction: Identifiable {
    case setEnabled(Bool)
    case setDefault
    case rename(String)
    case reset

    var id: String {
        switch self {
        case .setEnabled(let on): "enabled-\(on)"
        case .setDefault: "default"
        case .rename: "rename"
        case .reset: "reset"
        }
    }

    var op: String {
        switch self {
        case .setEnabled: "engine.setEnabled"
        case .setDefault: "engine.setDefault"
        case .rename: "engine.rename"
        case .reset: "engine.reset"
        }
    }

    func args(_ id: String) -> [String: Any] {
        switch self {
        case .setEnabled(let on): ["id": id, "enabled": on]
        case .setDefault, .reset: ["id": id]
        case .rename(let name): ["id": id, "name": name]
        }
    }

    func label(_ e: EngineSetting) -> String {
        switch self {
        case .setEnabled(let on): on ? String(localized: "switch on") : String(localized: "switch off")
        case .setDefault: String(localized: "make default")
        case .rename: String(localized: "rename")
        case .reset: e.custom ? String(localized: "remove engine") : String(localized: "reset overrides")
        }
    }

    func prose(_ e: EngineSetting) -> String {
        switch self {
        case .setEnabled(let on):
            if on { return String(localized: "Switches \(e.name) on: the TUI offers it again and new tasks can default to it.") }
            if e.isDefault {
                return String(localized: "Switches \(e.name) off: the TUI stops offering it and new tasks stop defaulting to it. Its settings stay. It is the default, so another enabled engine takes over as default.")
            }
            return String(localized: "Switches \(e.name) off: the TUI stops offering it and new tasks stop defaulting to it. Its settings stay.")
        case .setDefault:
            if !e.enabled {
                return String(localized: "Makes \(e.name) the engine new tasks start with. It is switched off, so this switches it back on.")
            }
            return String(localized: "Makes \(e.name) the engine new tasks start with.")
        case .rename(let name):
            return name.isEmpty
                ? String(localized: "Clears the name override: \(e.id) goes back to its built-in name. The launch command stays.")
                : String(localized: "Renames \(e.id) to “\(name)” on the mac and in this app. The launch command stays.")
        case .reset:
            return e.custom
                ? String(localized: "Removes the custom engine \(e.name): its launch command, name and protocol are deleted from the mac.")
                : String(localized: "Clears the name and launch-command overrides for \(e.name). It goes back to its built-in settings; on or off stays as it is.")
        }
    }
}

/// An engine's facts and its four actions. Looks the engine up by id so a reload refreshes the sheet.
struct EngineDetail: View {
    let engineId: String
    var engines: [EngineSetting]
    var reload: () async -> Void
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var pending: EngineAction?
    @State private var name = ""
    @State private var seeded = false

    private var engine: EngineSetting? { engines.first { $0.id == engineId } }

    var body: some View {
        SheetScaffold(title: engine?.name ?? engineId, kicker: String(localized: "engine")) {
            if let engine {
                facts(engine)
                actions(engine)
            } else {
                EmptyState(title: String(localized: "engine gone"), detail: String(localized: "it is no longer in the registry"))
            }
        }
        .onAppear {
            if !seeded, let engine { name = engine.name; seeded = true }
        }
        .onChange(of: engine == nil) { _, gone in if gone { dismiss() } }
        .sheet(item: $pending) { action in
            if let engine {
                SettingsConfirmSheet(title: String(localized: "\(action.label(engine))?"), kicker: String(localized: "engine"), prose: action.prose(engine),
                             label: action.label(engine), run: {
                    _ = try await model.client.request(action.op, action.args(engine.id), as: EmptyResult.self)
                    await reload()
                }, failed: { await reload() })
            }
        }
    }

    private func facts(_ e: EngineSetting) -> some View {
        VStack(spacing: 0) {
            SettingsInfoRow(key: "id", value: e.id)
            SettingsDivider()
            SettingsInfoRow(key: String(localized: "kind"), value: e.custom ? String(localized: "custom") : e.builtin ? String(localized: "built-in") : String(localized: "detected"))
            SettingsDivider()
            SettingsInfoRow(key: String(localized: "status"), value: [e.enabled ? String(localized: "on") : String(localized: "off"), e.isDefault ? String(localized: "default") : nil]
                .compactMap { $0 }.joined(separator: " · "))
            SettingsDivider()
            SettingsInfoRow(key: String(localized: "binary"), value: e.binaryFound == false ? String(localized: "not found") : (e.binaryPath ?? e.binary ?? "—"),
                    tint: e.binaryFound == false ? Theme.warning : Theme.ink)
            SettingsDivider()
            SettingsInfoRow(key: String(localized: "account"), value: EngineLogic.loginText(e))
            SettingsDivider()
            SettingsInfoRow(key: String(localized: "reports"), value: EngineLogic.reportText(e))
        }
        .tile()
    }

    @ViewBuilder
    private func actions(_ e: EngineSetting) -> some View {
        if let issue = e.configIssue, !issue.isEmpty { ErrorLine(text: issue) }
        FormSection(label: String(localized: "actions")) {
            VStack(spacing: 0) {
                if e.enabled {
                    let can = EngineLogic.canDisable(e, in: engines)
                    ActionRow(title: String(localized: "switch off"), tint: can ? Theme.ink : Theme.muted) {
                        if can { pending = .setEnabled(false) }
                    }
                    .accessibilityIdentifier("engineSwitchOff")
                } else {
                    ActionRow(title: String(localized: "switch on")) { pending = .setEnabled(true) }
                        .accessibilityIdentifier("engineSwitchOn")
                }
                if e.canBeDefault && !e.isDefault {
                    SettingsDivider()
                    ActionRow(title: String(localized: "make default")) { pending = .setDefault }
                        .accessibilityIdentifier("engineMakeDefault")
                }
                SettingsDivider()
                ActionRow(title: e.custom ? String(localized: "remove engine") : String(localized: "reset overrides"), tint: Theme.error) { pending = .reset }
                    .accessibilityIdentifier("engineReset")
            }
            .tile()
            if e.enabled && !EngineLogic.canDisable(e, in: engines) {
                Hint(text: String(localized: "the last enabled engine stays on"))
            }
            if !e.canBeDefault {
                Hint(text: String(localized: "only built-in and custom engines can be the default"))
            }
        }
        FormSection(label: String(localized: "display name")) {
            FieldBox { TextField("name", text: $name) }
                .accessibilityIdentifier("engineNameField")
            let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
            ActionRow(title: trimmed.isEmpty ? String(localized: "clear name override") : String(localized: "rename"), tint: Theme.accent) {
                pending = .rename(trimmed)
            }
            .tile()
            .accessibilityIdentifier("engineRename")
            Hint(text: String(localized: "blank clears the override and brings back the built-in name"))
        }
    }
}
