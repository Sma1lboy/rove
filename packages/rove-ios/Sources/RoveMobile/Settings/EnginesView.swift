import SwiftUI

private struct EngineRef: Identifiable { var id: String }

/// The engines registry as Settings → Engines shows it (`engines.settings`). Tap a row for its actions.
struct EnginesView: View {
    @Environment(AppModel.self) private var model
    @State private var state: SettingsLoad<EnginesSettingsPayload> = .loading
    @State private var reloadError: String?
    @State private var selected: EngineRef?

    var body: some View {
        SettingsPage(title: String(localized: "engines"), refresh: { await load() }) {
            switch state {
            case .loading:
                BrailleSpinner(size: 14)
            case .failed(let message):
                ErrorLine(text: message)
            case .loaded(let payload):
                if let reloadError { ErrorLine(text: reloadError) }
                if payload.engines.isEmpty {
                    EmptyState(title: String(localized: "no engines"), detail: String(localized: "the mac reports no engines"))
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(payload.engines.enumerated()), id: \.element.id) { index, engine in
                            if index > 0 { SettingsDivider() }
                            Button { selected = EngineRef(id: engine.id) } label: { EngineRow(engine: engine) }
                                .buttonStyle(RowButtonStyle())
                                .accessibilityIdentifier("engineRow-\(engine.id)")
                        }
                    }
                    .tile()
                }
                Hint(text: String(localized: "launch commands are edited on the mac — a command typed on a phone would run on the mac"))
            }
        }
        .task { await load() }
        .sheet(item: $selected) { ref in
            EngineDetail(engineId: ref.id, engines: state.value?.engines ?? []) { await load() }
        }
    }

    private func load() async {
        do {
            state = .loaded(try await model.client.request("engines.settings", as: EnginesSettingsPayload.self))
            reloadError = nil
        } catch {
            if state.value == nil { state = .failed(error.localizedDescription) } else { reloadError = error.localizedDescription }
        }
    }
}

private struct EngineRow: View {
    var engine: EngineSetting

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 8) {
                Text(engine.name).font(Theme.face(16, .medium)).foregroundStyle(engine.enabled ? Theme.ink : Theme.muted)
                    .lineLimit(1)
                if engine.isDefault { SettingsTag(text: String(localized: "default"), tint: Theme.accent, bold: true) }
                if !engine.enabled { SettingsTag(text: String(localized: "off")) }
                if engine.custom { SettingsTag(text: String(localized: "custom")) }
                Spacer()
            }
            HStack(spacing: 6) {
                if engine.binaryFound == false {
                    Text("not found").font(Theme.mono(12)).foregroundStyle(Theme.warning)
                } else {
                    Text(engine.binaryPath ?? engine.binary ?? "—").font(Theme.mono(12)).foregroundStyle(Theme.ink)
                        .lineLimit(1).truncationMode(.middle)
                }
                Text("·").font(Theme.mono(12)).foregroundStyle(Theme.muted)
                Text(EngineLogic.loginText(engine)).font(Theme.mono(12)).foregroundStyle(Theme.ink).lineLimit(1)
            }
            Text(EngineLogic.reportText(engine)).font(Theme.mono(12)).foregroundStyle(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)
            if let issue = engine.configIssue, !issue.isEmpty { ErrorLine(text: issue) }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}
