import SwiftUI

/// `−  3  +` chips on tiles.
struct CountStepper: View {
    @Binding var value: Int
    var range: ClosedRange<Int>
    var canIncrement = true

    var body: some View {
        HStack(spacing: 6) {
            step("−", String(localized: "decrease"), value > range.lowerBound) { value -= 1 }
            Text("\(value)").font(Theme.mono(14, .semibold)).foregroundStyle(Theme.ink).frame(minWidth: 28)
            step("+", String(localized: "increase"), value < range.upperBound && canIncrement) { value += 1 }
        }
    }

    private func step(_ glyph: String, _ name: String, _ enabled: Bool, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(glyph).font(Theme.mono(16, .medium)).foregroundStyle(enabled ? Theme.ink : Theme.muted)
                .frame(width: 40, height: 40).tile()
        }
        .buttonStyle(.pressable)
        .disabled(!enabled)
        .accessibilityLabel(name)
    }
}

/// The collapsible `+ options` block of the existing form: branch name, model, effort, fan-out.
struct NewTaskOptions: View {
    @Bindable var draft: NewTaskDraft

    private var fanOut: Bool { draft.spawn.isFanOut }
    private var models: [EngineModel] { draft.selectedEngine?.models ?? [] }
    private var levels: [String] { draft.selectedEngine?.effortLevels ?? [] }

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            Button { withAnimation(Theme.spring) { draft.optionsOpen.toggle() } } label: {
                Text(draft.optionsOpen ? String(localized: "− options") : String(localized: "+ options"))
                    .font(Theme.mono(13, .medium))
                    .foregroundStyle(draft.optionsOpen ? Theme.accent : Theme.muted)
                    .frame(maxWidth: .infinity, minHeight: 36, alignment: .leading)
            }
            .buttonStyle(.pressable)
            .accessibilityIdentifier("optionsToggle")
            if draft.optionsOpen {
                branchName
                if !models.isEmpty { modelSection }
                if !levels.isEmpty { effortSection }
                countSection
                agentsSection
                Hint(text: String(localized: "count or agents, not both. fan-out needs a first prompt."))
            }
        }
    }

    private var branchName: some View {
        FormSection(label: String(localized: "branch name"), trailing: fanOut ? String(localized: "single task only") : nil) {
            FieldBox {
                TextField("", text: $draft.spawn.branch, prompt: Text("optional — derived from the title").foregroundStyle(Theme.muted))
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .disabled(fanOut)
                    .accessibilityIdentifier("branchField")
            }
            .opacity(fanOut ? 0.5 : 1)
        }
    }

    private var modelSection: some View {
        FormSection(label: String(localized: "model")) {
            FieldBox {
                TextField("", text: $draft.spawn.model, prompt: Text("engine default").foregroundStyle(Theme.muted))
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .accessibilityIdentifier("modelField")
            }
            ScrollView(.horizontal, showsIndicators: false) {
                ChoiceTiles(options: models.map(\.id), selection: $draft.spawn.model, label: { id in
                    models.first { $0.id == id }?.name ?? id
                }, fill: false)
            }
        }
    }

    private var effortSection: some View {
        FormSection(label: String(localized: "effort")) {
            ScrollView(.horizontal, showsIndicators: false) {
                ChoiceTiles(options: [""] + levels, selection: $draft.spawn.effort, label: { $0.isEmpty ? String(localized: "default") : $0 }, fill: false)
            }
        }
    }

    private var countSection: some View {
        FormSection(label: String(localized: "count")) {
            HStack {
                CountStepper(value: Binding(get: { draft.spawn.count }, set: { n in
                    draft.spawn.count = SpawnDraft.clampCount(n)
                    if draft.spawn.count > 1 { draft.spawn.agents = [:] }
                }), range: 1...AgentsPlan.maxCount)
                Spacer()
            }
        }
    }

    private var agentsSection: some View {
        let total = AgentsPlan.total(draft.spawn.agents)
        return FormSection(label: String(localized: "agents"), trailing: total > 0 ? "\(total)/\(AgentsPlan.maxTotal)" : nil) {
            VStack(spacing: 6) {
                ForEach(draft.engines) { engine in
                    HStack {
                        Text(engine.name.lowercased()).font(Theme.mono(14)).foregroundStyle(Theme.ink)
                        Spacer()
                        CountStepper(value: agentBinding(engine.id), range: 0...AgentsPlan.maxTotal,
                                     canIncrement: AgentsPlan.canIncrement(draft.spawn.agents))
                    }
                }
            }
            if draft.spawn.usesAgents {
                Text(draft.spawn.agentsString).font(Theme.mono(12)).foregroundStyle(Theme.muted)
            }
        }
    }

    private func agentBinding(_ id: String) -> Binding<Int> {
        Binding(get: { draft.spawn.agents[id] ?? 0 }, set: { n in
            let delta = n - (draft.spawn.agents[id] ?? 0)
            draft.spawn.agents = AgentsPlan.adjusting(draft.spawn.agents, engine: id, by: delta)
            if draft.spawn.usesAgents { draft.spawn.count = 1 }
        })
    }
}
