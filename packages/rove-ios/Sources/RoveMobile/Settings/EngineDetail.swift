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
        case .setEnabled(let on): on ? "switch on" : "switch off"
        case .setDefault: "make default"
        case .rename: "rename"
        case .reset: e.custom ? "remove engine" : "reset overrides"
        }
    }

    func prose(_ e: EngineSetting) -> String {
        switch self {
        case .setEnabled(let on):
            if on { return "Switches \(e.name) on: it is offered again when you pick an engine for a task." }
            let handoff = e.isDefault ? " It is the default, so another enabled engine takes over as default." : ""
            return "Switches \(e.name) off: it stops being offered when you pick an engine for a task. Its settings stay.\(handoff)"
        case .setDefault:
            let on = e.enabled ? "" : " It is switched off, so this switches it back on."
            return "Makes \(e.name) the engine new tasks start with.\(on)"
        case .rename(let name):
            return name.isEmpty
                ? "Clears the name override: \(e.id) goes back to its built-in name. The launch command stays."
                : "Renames \(e.id) to “\(name)” on the mac and in this app. The launch command stays."
        case .reset:
            return e.custom
                ? "Removes the custom engine \(e.name): its launch command, name and protocol are deleted from the mac."
                : "Clears the name and launch-command overrides for \(e.name). It goes back to its built-in settings; on or off stays as it is."
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
        SheetScaffold(title: engine?.name ?? engineId, kicker: "engine") {
            if let engine {
                facts(engine)
                actions(engine)
            } else {
                EmptyState(title: "engine gone", detail: "it is no longer in the registry")
            }
        }
        .onAppear {
            if !seeded, let engine { name = engine.name; seeded = true }
        }
        .onChange(of: engine == nil) { _, gone in if gone { dismiss() } }
        .sheet(item: $pending) { action in
            if let engine {
                SettingsConfirmSheet(title: "\(action.label(engine))?", kicker: "engine", prose: action.prose(engine),
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
            SettingsInfoRow(key: "kind", value: e.custom ? "custom" : e.builtin ? "built-in" : "detected")
            SettingsDivider()
            SettingsInfoRow(key: "status", value: [e.enabled ? "on" : "off", e.isDefault ? "default" : nil]
                .compactMap { $0 }.joined(separator: " · "))
            SettingsDivider()
            SettingsInfoRow(key: "binary", value: e.binaryFound == false ? "not found" : (e.binaryPath ?? e.binary ?? "—"),
                    tint: e.binaryFound == false ? Theme.warning : Theme.ink)
            SettingsDivider()
            SettingsInfoRow(key: "account", value: EngineLogic.loginText(e))
            SettingsDivider()
            SettingsInfoRow(key: "reports", value: EngineLogic.reportText(e))
        }
        .tile()
    }

    @ViewBuilder
    private func actions(_ e: EngineSetting) -> some View {
        if let issue = e.configIssue, !issue.isEmpty { ErrorLine(text: issue) }
        FormSection(label: "actions") {
            VStack(spacing: 0) {
                if e.enabled {
                    let can = EngineLogic.canDisable(e, in: engines)
                    ActionRow(title: "switch off", tint: can ? Theme.ink : Theme.muted) {
                        if can { pending = .setEnabled(false) }
                    }
                    .accessibilityIdentifier("engineSwitchOff")
                } else {
                    ActionRow(title: "switch on") { pending = .setEnabled(true) }
                        .accessibilityIdentifier("engineSwitchOn")
                }
                if e.canBeDefault && !e.isDefault {
                    SettingsDivider()
                    ActionRow(title: "make default") { pending = .setDefault }
                        .accessibilityIdentifier("engineMakeDefault")
                }
                SettingsDivider()
                ActionRow(title: e.custom ? "remove engine" : "reset overrides", tint: Theme.error) { pending = .reset }
                    .accessibilityIdentifier("engineReset")
            }
            .tile()
            if e.enabled && !EngineLogic.canDisable(e, in: engines) {
                Hint(text: "the last enabled engine stays on")
            }
            if !e.canBeDefault {
                Hint(text: "only built-in and custom engines can be the default")
            }
        }
        FormSection(label: "display name") {
            FieldBox { TextField("name", text: $name) }
                .accessibilityIdentifier("engineNameField")
            let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
            ActionRow(title: trimmed.isEmpty ? "clear name override" : "rename", tint: Theme.accent) {
                pending = .rename(trimmed)
            }
            .tile()
            .accessibilityIdentifier("engineRename")
            Hint(text: "blank clears the override and brings back the built-in name")
        }
    }
}
