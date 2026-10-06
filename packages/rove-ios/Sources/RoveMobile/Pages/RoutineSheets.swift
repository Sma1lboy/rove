import SwiftUI

/// Create a routine, or edit one (`editing`): name, prompt and schedule only. The repo is fixed once
/// created, and a precheck is never authored here — it runs a shell command, so it stays a mac setting.
struct RoutineEditorSheet: View {
    var editing: Routine?
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var repos: [String] = []
    @State private var repo: String
    @State private var name: String
    @State private var prompt: String
    @State private var schedule: String
    @State private var busy = false
    @State private var error: String?

    private struct Preset {
        let name: String
        let cron: String
    }

    private static let presets = [
        Preset(name: "hourly", cron: "0 * * * *"),
        Preset(name: "daily 9:00", cron: "0 9 * * *"),
        Preset(name: "weekdays", cron: "0 9 * * MON-FRI"),
        Preset(name: "weekly", cron: "0 9 * * MON"),
    ]

    /// The bridge's own caps (`NAME_MAX`, `PROMPT_MAX`), counted in UTF-16 units as JS does.
    private static let nameMax = 120
    private static let promptMax = 20_000

    init(editing: Routine? = nil) {
        self.editing = editing
        _repo = State(initialValue: editing?.repo ?? "")
        _name = State(initialValue: editing?.name ?? "")
        _prompt = State(initialValue: editing?.prompt ?? "")
        _schedule = State(initialValue: editing?.schedule ?? "")
    }

    var body: some View {
        SheetScaffold(title: editing == nil ? "new routine" : "edit routine",
                      kicker: editing?.name ?? "cron + prompt",
                      error: error,
                      primary: PrimaryBar(label: editing == nil ? "create routine" : "save routine",
                                          enabled: ready, busy: busy,
                                          identifier: editing == nil ? "createRoutine" : "saveRoutine") {
                          Task { await save() }
                      }) {
            FormSection(label: "name") {
                FieldBox {
                    TextField("", text: $name, prompt: Text("nightly dependency audit").foregroundStyle(Theme.muted))
                        .accessibilityIdentifier("routineName")
                }
            }
            repoSection
            FormSection(label: "prompt") {
                PromptEditor(text: $prompt, placeholder: "what the agent should do each time it fires", minHeight: 140)
                    .accessibilityIdentifier("routinePrompt")
            }
            scheduleSection
            if let problem = lengthProblem { ErrorLine(text: problem) }
        }
        .task { if editing == nil { await loadRepos() } }
    }

    // MARK: Sections

    @ViewBuilder private var repoSection: some View {
        if let editing {
            FormSection(label: "repository") {
                VStack(alignment: .leading, spacing: 2) {
                    Text(editing.repoName).font(Theme.mono(14, .medium)).foregroundStyle(Theme.muted)
                    Text(editing.repo).font(Theme.mono(11)).foregroundStyle(Theme.muted)
                        .lineLimit(1).truncationMode(.head)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 14).padding(.vertical, 10)
                .tile(Theme.inset)
                Hint(text: "the repo is fixed once a routine exists — recreate it to move it")
            }
        } else {
            FormSection(label: "repository", trailing: repos.isEmpty ? nil : String(format: "%02d", repos.count)) {
                if repos.isEmpty && error == nil { BrailleSpinner(size: 13) }
                VStack(spacing: 6) {
                    ForEach(repos, id: \.self) { path in repoRow(path) }
                }
            }
        }
    }

    private func repoRow(_ path: String) -> some View {
        let on = path == repo
        let base = URL(fileURLWithPath: path).lastPathComponent
        return Button { withAnimation(Theme.spring) { repo = path } } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text(base)
                    .font(Theme.mono(14, on ? .semibold : .medium))
                    .foregroundStyle(on ? Theme.accent : Theme.ink)
                Text(path).font(Theme.mono(11)).foregroundStyle(Theme.muted).lineLimit(1).truncationMode(.head)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 14).padding(.vertical, 10)
            .selectableTile(on)
        }
        .buttonStyle(.pressable)
        .accessibilityIdentifier("routineRepo-\(base)")
    }

    private var scheduleSection: some View {
        FormSection(label: "schedule") {
            FieldBox {
                TextField("", text: $schedule, prompt: Text("0 9 * * *").foregroundStyle(Theme.muted))
                    .keyboardType(.asciiCapable)
                    .accessibilityIdentifier("routineSchedule")
            }
            ScrollView(.horizontal, showsIndicators: false) {
                ChoiceTiles(options: Self.presets.map { $0.cron }, selection: normalizedBinding, label: { cron in
                    Self.presets.first { $0.cron == cron }?.name ?? cron
                }, fill: false)
            }
            .accessibilityIdentifier("routinePresets")
            if showsScheduleError {
                ErrorLine(text: "schedule needs five space-separated cron fields: minute hour day month weekday")
            }
            Hint(text: "five-field cron, in the mac's local time")
        }
    }

    /// A tile lights when the field holds its expression, however the spaces were typed.
    private var normalizedBinding: Binding<String> {
        Binding(get: { normalizedSchedule }, set: { schedule = $0 })
    }

    // MARK: Validation

    private static func normalize(_ text: String) -> String {
        text.split(whereSeparator: { $0 == " " || $0 == "\t" || $0 == "\n" }).joined(separator: " ")
    }

    private var normalizedSchedule: String { Self.normalize(schedule) }
    private var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var trimmedPrompt: String { prompt.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var scheduleValid: Bool { RoutineLogic.validSchedule(normalizedSchedule) }

    /// Only once the user typed something: an empty field is just not filled in yet.
    private var showsScheduleError: Bool { !normalizedSchedule.isEmpty && !scheduleValid }

    private var lengthProblem: String? {
        if trimmedName.utf16.count > Self.nameMax { return "name is longer than \(Self.nameMax) characters" }
        if trimmedPrompt.utf16.count > Self.promptMax { return "prompt is longer than \(Self.promptMax) characters" }
        return nil
    }

    /// Edit mode sends only what differs from the saved routine.
    private var changes: [String: Any] {
        guard let editing else { return [:] }
        var changed: [String: Any] = [:]
        if trimmedName != editing.name.trimmingCharacters(in: .whitespacesAndNewlines) { changed["name"] = trimmedName }
        if trimmedPrompt != editing.prompt.trimmingCharacters(in: .whitespacesAndNewlines) {
            changed["prompt"] = trimmedPrompt
        }
        if normalizedSchedule != Self.normalize(editing.schedule) { changed["schedule"] = normalizedSchedule }
        return changed
    }

    private var ready: Bool {
        guard !trimmedName.isEmpty, !trimmedPrompt.isEmpty, scheduleValid, lengthProblem == nil else { return false }
        return editing == nil ? !repo.isEmpty : !changes.isEmpty
    }

    // MARK: Ops

    private func loadRepos() async {
        do {
            repos = try await model.client.request("repos.list", as: ReposResult.self).repos
            if repo.isEmpty {
                let preferred = [model.store.repoFilter].compactMap { $0 }.first { repos.contains($0) }
                repo = preferred ?? repos.first ?? ""
            }
        } catch { self.error = error.localizedDescription }
    }

    private func save() async {
        busy = true
        defer { busy = false }
        error = nil
        do {
            if let editing {
                var args = changes
                args["id"] = editing.id
                _ = try await model.client.request("routine.update", args, as: EmptyResult.self)
            } else {
                let args: [String: Any] = [
                    "repo": repo, "name": trimmedName, "prompt": trimmedPrompt, "schedule": normalizedSchedule,
                ]
                _ = try await model.client.request("routine.create", args, as: RoutineCreateResult.self)
            }
            dismiss()
        } catch { self.error = error.localizedDescription }
    }
}

/// `routine.delete`: states the boundary (history goes, tasks stay) before anything changes.
struct RoutineDeleteSheet: View {
    let routine: Routine
    var deleted: () -> Void
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        SheetScaffold(title: "delete this routine?", kicker: "delete", error: error,
                      primary: PrimaryBar(label: "delete routine", destructive: true, busy: busy,
                                          identifier: "confirmDeleteRoutine") { Task { await run() } }) {
            Text(routine.name).font(Theme.mono(14, .semibold)).foregroundStyle(Theme.ink)
            Text("Deletes the routine and its run history. Tasks it already created stay.")
                .font(Theme.face(16)).foregroundStyle(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)
        }
        .presentationDetents([.medium])
    }

    private func run() async {
        busy = true
        defer { busy = false }
        do {
            _ = try await model.client.request("routine.delete", ["id": routine.id], as: EmptyResult.self)
            dismiss()
            deleted()
        } catch { self.error = error.localizedDescription }
    }
}
