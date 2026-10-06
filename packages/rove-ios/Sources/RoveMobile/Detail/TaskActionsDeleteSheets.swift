import SwiftUI

/// The red confirmation behind every destructive task action: delete a task, remove a directory entry,
/// forget a project, remove a worktree. The menu tap and the first dialog come before it; when the bridge
/// refuses a dirty worktree this sheet turns into the second destructive confirmation and retries with `force`.
struct DestructiveConfirmSheet: View {
    var done: () -> Void
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    // Captured once: the row can vanish (or change kind) while this sheet is up.
    @State private var plan: TaskActionLogic.ConfirmPlan
    @State private var taskId: String?
    @State private var repo: String?
    @State private var force = false
    /// The bridge's dirty-worktree refusal; non-nil = the second confirmation is showing.
    @State private var dirty: String?
    @State private var error: String?
    @State private var busy = false

    init(plan: TaskActionLogic.ConfirmPlan, taskId: String?, repo: String?, done: @escaping () -> Void) {
        _plan = State(initialValue: plan)
        _taskId = State(initialValue: taskId)
        _repo = State(initialValue: repo)
        self.done = done
    }

    private var identifier: String {
        switch plan.flow {
        case .deleteTask, .removeEntry: "confirmDeleteButton"
        case .forgetProject: "confirmForgetButton"
        case .removeWorktree: "confirmRemoveWorktreeButton"
        }
    }

    var body: some View {
        SheetScaffold(title: dirty == nil ? plan.sheetTitle : "discard uncommitted changes?",
                      kicker: dirty == nil ? plan.kicker : "second confirmation", error: error,
                      primary: primary) {
            if let dirty { forceStep(dirty) } else { firstStep }
        }
        .presentationDetents([.medium, .large])
    }

    private var primary: PrimaryBar {
        if dirty != nil {
            PrimaryBar(label: plan.forceLabel, destructive: true, busy: busy, identifier: "confirmForceButton") { Task { await run(force: true) } }
        } else {
            PrimaryBar(label: plan.confirmLabel, destructive: true, busy: busy, identifier: identifier) { Task { await run(force: force) } }
        }
    }

    @ViewBuilder private var firstStep: some View {
        Text(plan.body).font(Theme.face(16)).foregroundStyle(Theme.ink).fixedSize(horizontal: false, vertical: true)
        if let toggle = plan.forceToggleLabel {
            CheckRow(label: toggle, on: $force).accessibilityIdentifier("forceToggle")
        }
        if let hint = plan.hint { Hint(text: hint) }
    }

    @ViewBuilder private func forceStep(_ detail: String) -> some View {
        Text(detail).font(Theme.mono(12)).foregroundStyle(Theme.ink)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .tile()
            .accessibilityIdentifier("dirtyDetail")
        Text(plan.forceBody).font(Theme.face(16)).foregroundStyle(Theme.ink).fixedSize(horizontal: false, vertical: true)
        ActionRow(title: "keep it, go back", tint: Theme.muted) {
            withAnimation(Theme.spring) { dirty = nil; error = nil }
        }
    }

    private func run(force: Bool) async {
        busy = true
        defer { busy = false }
        let args = TaskActionLogic.args(for: plan, taskId: taskId, repo: repo, force: force)
        do {
            if plan.flow == .removeWorktree {
                let r = try await model.client.request(plan.flow.op, args, as: RemoveWorktreeResult.self)
                guard r.removed else { error = "nothing was removed — the task has no worktree on disk"; return }
            } else {
                _ = try await model.client.request(plan.flow.op, args, as: EmptyResult.self)
            }
            await model.store.refresh()
            dismiss()
            done()
        } catch {
            if plan.retriesWithForce, !force, TaskActionLogic.isDirtyRefusal(error) {
                withAnimation(Theme.spring) { dirty = TaskActionLogic.dirtyDetail(error); self.error = nil }
            } else {
                self.error = error.localizedDescription
            }
        }
    }
}
