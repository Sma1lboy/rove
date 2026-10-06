import SwiftUI

/// One routine: prompt, read-only precheck, schedule, repo, recent runs and the actions
/// (pause/resume, run now, open the latest task, edit, delete). Shown as a sheet from `RoutinesView`.
struct RoutineDetail: View {
    var onOpenTask: (String) -> Void
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var routine: Routine
    @State private var runs: [RoutineRun]?
    @State private var runsError: String?
    @State private var error: String?
    @State private var busy = false
    @State private var expanded: Set<String> = []
    @State private var confirmRun = false
    @State private var modal: Modal?
    @State private var wasDeleted = false

    private enum Modal: String, Identifiable {
        case edit, delete
        var id: String { rawValue }
    }

    init(routine: Routine, onOpenTask: @escaping (String) -> Void) {
        _routine = State(initialValue: routine)
        self.onOpenTask = onOpenTask
    }

    private var latestTaskId: String? { runs?.first?.taskId }

    var body: some View {
        SheetScaffold(title: routine.name, kicker: String(localized: "routine"), error: error) {
            promptSection
            precheckSection
            scheduleSection
            repoSection
            runsSection
            actionsSection
        }
        .task { await reloadRuns() }
        .confirmationDialog("run now?", isPresented: $confirmRun, titleVisibility: .visible) {
            Button("run now") { Task { await runNow() } }
            Button("cancel", role: .cancel) {}
        } message: {
            Text("starts an agent session on the mac and skips the precheck")
        }
        .sheet(item: $modal, onDismiss: { Task { await refresh() } }) { modal in
            switch modal {
            case .edit:
                RoutineEditorSheet(editing: routine)
            case .delete:
                RoutineDeleteSheet(routine: routine) {
                    wasDeleted = true
                    dismiss()
                }
            }
        }
    }

    // MARK: Sections

    private var promptSection: some View {
        FormSection(label: String(localized: "prompt")) {
            Text(routine.prompt)
                .font(Theme.face(15)).foregroundStyle(Theme.ink)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(14)
                .tile()
        }
    }

    private var precheckSection: some View {
        FormSection(label: String(localized: "precheck")) {
            VStack(alignment: .leading, spacing: 6) {
                if let precheck = routine.precheck {
                    Text(precheck.command)
                        .font(Theme.mono(13)).foregroundStyle(Theme.ink)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                    if let seconds = precheck.timeoutSeconds {
                        Text("timeout \(seconds)s").font(Theme.mono(12)).foregroundStyle(Theme.muted)
                    }
                } else {
                    Text("none").font(Theme.mono(13)).foregroundStyle(Theme.muted)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .tile()
            Hint(text: String(localized: "prechecks are set on the mac — they run a shell command"))
        }
    }

    private var scheduleSection: some View {
        FormSection(label: String(localized: "schedule")) {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text(routine.schedule).font(Theme.mono(14, .semibold)).foregroundStyle(Theme.ink)
                    Spacer()
                    if !routine.enabled {
                        Text("paused").font(Theme.mono(11, .medium)).foregroundStyle(Theme.muted)
                    }
                }
                Text(nextLine).font(Theme.mono(12)).foregroundStyle(Theme.muted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .tile()
        }
    }

    /// `next Oct 6, 9:00 AM · in 3d` in this phone's clock; paused routines have no next run.
    private var nextLine: String {
        guard routine.enabled, let date = RoutineLogic.date(routine.nextRunAt) else { return String(localized: "next —") }
        let local = date.formatted(date: .abbreviated, time: .shortened)
        let until = RoutineLogic.until(routine.nextRunAt, now: Date())
        return String(localized: "next \(local) · \(until)")
    }

    private var repoSection: some View {
        FormSection(label: String(localized: "repo")) {
            VStack(alignment: .leading, spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(routine.repoName).font(Theme.mono(14, .semibold)).foregroundStyle(Theme.ink)
                    Text(routine.repo).font(Theme.mono(11)).foregroundStyle(Theme.muted)
                        .lineLimit(1).truncationMode(.head)
                }
                if routine.persistentSession || (routine.baseRef?.isEmpty == false) {
                    HStack(spacing: 6) {
                        if routine.persistentSession { tag(String(localized: "persistent session")) }
                        if let ref = routine.baseRef, !ref.isEmpty { tag(String(localized: "base \(ref)")) }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .tile()
        }
    }

    private func tag(_ text: String) -> some View {
        Text(text)
            .font(Theme.mono(11, .medium)).foregroundStyle(Theme.muted)
            .lineLimit(1)
            .padding(.horizontal, 8).padding(.vertical, 4)
            .tile(Theme.inset, radius: Theme.smallRadius)
    }

    private var runsSection: some View {
        FormSection(label: String(localized: "last runs"), trailing: runs.map { String(format: "%02d", min($0.count, 10)) }) {
            if let runs {
                if runs.isEmpty {
                    EmptyState(title: String(localized: "no runs yet"),
                               detail: String(localized: "run now fires one without waiting for the schedule"))
                } else {
                    let shown = Array(runs.prefix(10))
                    VStack(spacing: 0) {
                        ForEach(shown) { run in
                            runRow(run)
                            if run.id != shown.last?.id { divider }
                        }
                    }
                    .tile()
                }
            } else if let runsError {
                ErrorLine(text: runsError)
                Button { Task { await reloadRuns() } } label: { TileLabel(text: String(localized: "retry")) }
                    .buttonStyle(.pressable)
            } else {
                BrailleSpinner(size: 13)
            }
        }
    }

    private func runRow(_ run: RoutineRun) -> some View {
        let isOpen = expanded.contains(run.id)
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text(verbatim: "#\(run.runNumber)").font(Theme.mono(13, .semibold)).foregroundStyle(Theme.ink)
                RoutineStatusTag(status: run.status)
                Text(run.trigger).font(Theme.mono(11)).foregroundStyle(Theme.muted).lineLimit(1)
                Spacer(minLength: 8)
                Text(RoutineLogic.ago(run.at, now: Date())).font(Theme.mono(11)).foregroundStyle(Theme.muted)
            }
            if let message = run.error, !message.isEmpty { ErrorLine(text: message) }
            if let text = run.response?.text, !text.isEmpty {
                Button {
                    withAnimation(Theme.spring) { expanded = expanded.symmetricDifference([run.id]) }
                } label: {
                    Text(text)
                        .font(Theme.face(14)).foregroundStyle(Theme.muted)
                        .lineLimit(isOpen ? nil : 6)
                        .multilineTextAlignment(.leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(RowButtonStyle())
                .accessibilityIdentifier("routineRunResponse-\(run.id)")
            }
            if let taskId = run.taskId {
                Button { openTask(taskId) } label: { TileLabel(text: String(localized: "open task"), size: 12) }
                    .buttonStyle(.pressable)
                    .accessibilityIdentifier("routineRunTask-\(run.id)")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .accessibilityIdentifier("routineRun-\(run.id)")
    }

    private var actionsSection: some View {
        FormSection(label: String(localized: "actions")) {
            VStack(spacing: 0) {
                ActionRow(title: routine.enabled ? String(localized: "pause") : String(localized: "resume")) {
                    Task { await setEnabled(!routine.enabled) }
                }
                .accessibilityIdentifier("routineToggle")
                divider
                ActionRow(title: String(localized: "run now"), detail: String(localized: "skips the precheck")) { confirmRun = true }
                    .accessibilityIdentifier("routineRunNow")
                divider
                ActionRow(title: String(localized: "open latest run's task"), tint: latestTaskId == nil ? Theme.muted : Theme.ink) {
                    if let id = latestTaskId { openTask(id) }
                }
                .disabled(latestTaskId == nil)
                .accessibilityIdentifier("routineOpenTask")
                divider
                ActionRow(title: String(localized: "edit"), detail: String(localized: "name, prompt, schedule")) { modal = .edit }
                    .accessibilityIdentifier("routineEdit")
                divider
                ActionRow(title: String(localized: "delete"), tint: Theme.error) { modal = .delete }
                    .accessibilityIdentifier("routineDelete")
            }
            .disabled(busy)
            .tile()
        }
    }

    private var divider: some View { Rectangle().fill(Theme.line).frame(height: 1) }

    // MARK: Ops

    private func openTask(_ id: String) {
        onOpenTask(id)
        dismiss()
    }

    private func setEnabled(_ enabled: Bool) async {
        busy = true
        defer { busy = false }
        error = nil
        do {
            _ = try await model.client.request("routine.setEnabled", ["id": routine.id, "enabled": enabled],
                                               as: EmptyResult.self)
            await refresh()
        } catch { self.error = error.localizedDescription }
    }

    private func runNow() async {
        busy = true
        defer { busy = false }
        error = nil
        do {
            _ = try await model.client.request("routine.runNow", ["id": routine.id], as: EmptyResult.self)
            await refresh()
        } catch { self.error = error.localizedDescription }
    }

    /// The routine itself (state, next run) and its run history.
    private func refresh() async {
        guard !wasDeleted else { return }
        do {
            let list = try await model.client.request("routine.list", as: RoutinesPayload.self)
            if let fresh = list.automations.first(where: { $0.id == routine.id }) { routine = fresh }
        } catch { self.error = error.localizedDescription }
        await reloadRuns()
    }

    private func reloadRuns() async {
        do {
            runs = try await model.client.request("routine.runs", ["id": routine.id], as: RoutineRunsPayload.self).runs
            runsError = nil
        } catch { runsError = error.localizedDescription }
    }
}
