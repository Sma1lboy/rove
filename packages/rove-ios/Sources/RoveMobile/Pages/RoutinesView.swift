import SwiftUI

/// Mono status tag for a routine run outcome, toned by `RoutineLogic.tone`: healthy skips stay
/// muted, missed runs are amber, a prompt that never reached an engine is error red.
struct RoutineStatusTag: View {
    var status: String

    private var tint: Color {
        switch RoutineLogic.tone(status: status) {
        case .success: Theme.success
        case .muted: Theme.muted
        case .warning: Theme.warning
        case .error: Theme.error
        }
    }

    var body: some View {
        Text(RoutineLogic.label(status: status))
            .font(Theme.mono(11, .medium))
            .foregroundStyle(tint)
            .lineLimit(1)
            .fixedSize()
    }
}

/// Daemon-owned scheduled prompts (`rove api routine-*`). The list lives here; one routine opens
/// `RoutineDetail`, and `+` opens the create sheet.
struct RoutinesView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var payload: RoutinesPayload?
    @State private var starts: [PendingStart] = []
    @State private var error: String?
    @State private var sheet: RoutinesSheet?
    /// A task picked inside the detail sheet; pushed once that sheet is gone.
    @State private var pendingTask: String?

    private enum RoutinesSheet: Identifiable {
        case create
        case detail(Routine)

        var id: String {
            switch self {
            case .create: "create"
            case .detail(let routine): routine.id
            }
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            ScreenHeader(back: { dismiss() }) {
                Text("routines").font(Theme.face(16, .semibold)).foregroundStyle(Theme.ink)
            } trailing: {
                Button { sheet = .create } label: { HeaderIcon(systemName: "plus") }
                    .buttonStyle(.pressable)
                    .accessibilityLabel("New routine")
                    .accessibilityIdentifier("routineNew")
            }
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 8) {
                    content
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 24)
            }
            .refreshable { await load() }
        }
        .background(Theme.paper.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .task { await load() }
        .sheet(item: $sheet, onDismiss: sheetClosed) { sheet in
            switch sheet {
            case .create:
                RoutineEditorSheet()
            case .detail(let routine):
                RoutineDetail(routine: routine) { taskId in pendingTask = taskId }
            }
        }
    }

    @ViewBuilder private var content: some View {
        if let payload {
            Theme.kicker(String(localized: "\(String(format: "%02d", payload.automations.count)) routines"))
                .padding(.horizontal, 4)
            if let error { ErrorLine(text: error).padding(.horizontal, 4) }
            if payload.automations.isEmpty {
                EmptyState(title: String(localized: "no routines"), detail: String(localized: "+ schedules a prompt on a cron"))
                    .padding(.horizontal, 4).padding(.top, 12)
            }
            ForEach(payload.automations) { routine in
                row(routine, status: payload.lastRunStatus[routine.id])
            }
            if !starts.isEmpty {
                Theme.kicker(String(localized: "later \(starts.count)"))
                    .padding(.horizontal, 4).padding(.top, 12)
                ForEach(starts) { pendingRow($0) }
            }
            if payload.keepsDaemonAlive {
                Text("enabled routines keep the mac daemon alive")
                    .font(Theme.mono(12)).foregroundStyle(Theme.muted)
                    .padding(.horizontal, 4).padding(.top, 8)
            }
        } else if let error {
            ErrorLine(text: error).padding(.horizontal, 4)
            Button { Task { await load() } } label: { TileLabel(text: String(localized: "retry")) }
                .buttonStyle(.pressable)
                .padding(.horizontal, 4)
                .accessibilityIdentifier("routinesRetry")
        } else {
            HStack(spacing: 8) {
                BrailleSpinner(size: 13)
                Text("loading").font(Theme.mono(13)).foregroundStyle(Theme.muted)
            }
            .padding(.horizontal, 4).padding(.top, 16)
        }
    }

    private func row(_ routine: Routine, status: String?) -> some View {
        Button { sheet = .detail(routine) } label: {
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 8) {
                    Text(routine.name).font(Theme.mono(14, .semibold)).foregroundStyle(Theme.ink).lineLimit(1)
                    if !routine.enabled {
                        Text("paused").font(Theme.mono(11, .medium)).foregroundStyle(Theme.muted).fixedSize()
                    }
                    Spacer(minLength: 8)
                    if let status { RoutineStatusTag(status: status) }
                }
                Text(subtitle(routine))
                    .font(Theme.mono(12)).foregroundStyle(Theme.muted)
                    .lineLimit(2).multilineTextAlignment(.leading)
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .tile()
        }
        .buttonStyle(.pressable)
        .accessibilityIdentifier("routineRow-\(routine.id)")
    }

    private func pendingRow(_ start: PendingStart) -> some View {
        HStack(alignment: .top, spacing: 8) {
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 8) {
                    Text(start.title).font(Theme.mono(14, .semibold)).foregroundStyle(Theme.ink).lineLimit(1)
                    Spacer(minLength: 8)
                    if let when = TaskRowMarks.startsAt(start.at) {
                        Text(when).font(Theme.mono(12)).foregroundStyle(Theme.muted).fixedSize()
                    }
                }
                Text(URL(fileURLWithPath: start.repo).lastPathComponent)
                    .font(Theme.mono(12)).foregroundStyle(Theme.muted).lineLimit(1)
                if let failed = start.error {
                    Text("didn't start: \(failed)").font(Theme.mono(12)).foregroundStyle(Theme.warning).lineLimit(2)
                }
            }
            Button { Task { await cancel(start) } } label: { TileLabel(text: String(localized: "cancel")) }
                .buttonStyle(.pressable)
                .accessibilityIdentifier("pendingCancel-\(start.id)")
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .tile()
        .accessibilityIdentifier("pendingRow-\(start.id)")
    }

    private func cancel(_ start: PendingStart) async {
        do {
            _ = try await model.client.request("pendingStart.cancel", ["id": start.id])
            starts.removeAll { $0.id == start.id }
        } catch { self.error = error.localizedDescription }
    }

    /// `repoName · 0 9 * * * · next in 3d`; a paused routine has no next run.
    private func subtitle(_ routine: Routine) -> String {
        let next = routine.enabled ? RoutineLogic.until(routine.nextRunAt, now: Date()) : "—"
        return String(localized: "\(routine.repoName) · \(routine.schedule) · next \(next)")
    }

    private func load() async {
        do {
            payload = try await model.client.request("routine.list", as: RoutinesPayload.self)
            error = nil
            // An older bridge has no Later; the routines still show.
            starts = (try? await model.client.request("pendingStart.list", as: PendingStartsPayload.self))?.starts ?? []
        } catch { self.error = error.localizedDescription }
    }

    /// Any sheet may have changed a routine: reload, and open the task the detail asked for.
    private func sheetClosed() {
        if let id = pendingTask {
            pendingTask = nil
            model.path.append(.task(id))
        }
        Task { await load() }
    }
}
