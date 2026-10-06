import SwiftUI

/// P10: every worktree of every saved project, with what a person needs before deleting one —
/// dirty, on the remote or not, PR/merge verdict, age. Land a tracked task's branch, or remove a
/// worktree (dirty ones only with a second, explicit confirm).
struct WorktreesView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var projects: [WorktreeProject] = []
    @State private var loaded = false
    @State private var error: String?
    @State private var acting: WorktreeRow?
    @State private var notice: String?

    var body: some View {
        VStack(spacing: 0) {
            ScreenHeader(back: { dismiss() }) {
                Text("worktrees").font(Theme.face(16, .semibold)).foregroundStyle(Theme.ink)
            } trailing: {
                Button { Task { await load() } } label: { HeaderIcon(systemName: "arrow.clockwise") }
                    .buttonStyle(.pressable).accessibilityLabel("Refresh").accessibilityIdentifier("refreshButton")
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    if let notice { Text(notice).font(Theme.mono(12)).foregroundStyle(Theme.muted).accessibilityIdentifier("worktreeNotice") }
                    if let error {
                        ErrorLine(text: error).accessibilityIdentifier("worktreesError")
                        Button { Task { await load() } } label: { TileLabel(text: "retry", tint: Theme.accent) }.buttonStyle(.pressable)
                    } else if !loaded {
                        HStack(spacing: 8) { BrailleSpinner(size: 14, tint: Theme.muted); Text("asking the remotes").font(Theme.mono(12)).foregroundStyle(Theme.muted) }
                    } else if projects.isEmpty {
                        EmptyState(title: "no projects", detail: "save a project in rove and its worktrees list here")
                    } else {
                        ForEach(projects) { p in project(p) }
                    }
                }
                .padding(.horizontal, 20).padding(.bottom, 24)
            }
            .refreshable { await load() }
        }
        .background(Theme.paper.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .task { await load() }
        .sheet(item: $acting) { row in
            WorktreeActionSheet(row: row) { message in
                notice = message
                Task { await load() }
            }
        }
    }

    private func project(_ p: WorktreeProject) -> some View {
        FormSection(label: WorktreesLogic.projectName(p.repo), trailing: "\(p.worktrees.count)") {
            if p.worktrees.isEmpty {
                Text("no worktrees").font(Theme.mono(12)).foregroundStyle(Theme.muted)
            } else {
                VStack(spacing: 0) {
                    ForEach(p.worktrees) { row in
                        Button { acting = row } label: { rowView(row) }
                            .buttonStyle(RowButtonStyle())
                            .accessibilityIdentifier("worktree-\(row.path)")
                    }
                }
                .tile()
            }
        }
    }

    private func rowView(_ row: WorktreeRow) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 8) {
                Text(row.branch.isEmpty ? "detached" : row.branch).font(Theme.mono(13, .semibold)).foregroundStyle(Theme.ink)
                    .lineLimit(1).truncationMode(.middle)
                Spacer(minLength: 4)
                if let age = WorktreesLogic.age(ms: row.lastActivityMs ?? row.createdAtMs) {
                    Text(age).font(Theme.mono(11)).foregroundStyle(Theme.muted)
                }
            }
            HStack(spacing: 8) {
                ForEach(Array(WorktreesLogic.tags(row).enumerated()), id: \.offset) { _, t in
                    Text(t.text).font(Theme.mono(11, .medium)).foregroundStyle(color(t.tone))
                }
            }
            Text(row.path).font(Theme.mono(11)).foregroundStyle(Theme.muted).lineLimit(1).truncationMode(.head)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12).padding(.vertical, 10)
    }

    private func color(_ tone: WorktreeTag.Tone) -> Color {
        switch tone { case .quiet: Theme.muted; case .good: Theme.success; case .warn: Theme.accent }
    }

    private func load() async {
        do {
            projects = try await model.client.request("worktrees.list", ["network": true], as: WorktreesResult.self).projects
            error = nil
        } catch { self.error = error.localizedDescription }
        loaded = true
    }
}

/// What can be done to one worktree. Both actions are confirmed; forcing a dirty removal is a
/// separate, second confirm that quotes git's reason.
struct WorktreeActionSheet: View {
    let row: WorktreeRow
    var done: (String) -> Void
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var confirmRemove = false
    @State private var confirmLand = false
    @State private var dirtyReason: String?
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        SheetScaffold(title: row.branch.isEmpty ? "detached" : row.branch, kicker: "worktree", error: error) {
            Text(row.path).font(Theme.mono(12)).foregroundStyle(Theme.muted).textSelection(.enabled)
            HStack(spacing: 8) {
                ForEach(Array(WorktreesLogic.tags(row).enumerated()), id: \.offset) { _, t in
                    Text(t.text).font(Theme.mono(12, .medium)).foregroundStyle(t.tone == .good ? Theme.success : t.tone == .warn ? Theme.accent : Theme.muted)
                }
            }
            VStack(spacing: 0) {
                if row.canLand, let id = row.taskId {
                    ActionRow(title: "land branch", detail: "merge or squash into main") { confirmLand = true; _ = id }
                        .accessibilityIdentifier("landWorktree")
                } else {
                    Text("not a tracked task branch — only removal is available")
                        .font(Theme.mono(12)).foregroundStyle(Theme.muted).padding(14)
                }
                ActionRow(title: "remove worktree", detail: row.dirty == true ? "has uncommitted work" : nil, tint: Theme.error) { confirmRemove = true }
                    .accessibilityIdentifier("removeWorktree")
            }
            .tile()
            if busy { HStack(spacing: 8) { BrailleSpinner(size: 14, tint: Theme.muted); Text("working").font(Theme.mono(12)).foregroundStyle(Theme.muted) } }
        }
        .confirmationDialog("Remove this worktree?", isPresented: $confirmRemove, titleVisibility: .visible) {
            Button("Remove worktree", role: .destructive) { Task { await remove(force: false) } }
        } message: { Text("Deletes \(row.path). The branch stays.") }
        .confirmationDialog("Land this branch", isPresented: $confirmLand, titleVisibility: .visible) {
            Button("Merge") { Task { await land("merge") } }
            Button("Squash") { Task { await land("squash") } }
        } message: { Text("Lands \(row.branch) into the main branch, then removes its worktree.") }
        .confirmationDialog("Remove despite uncommitted work?", isPresented: Binding(get: { dirtyReason != nil }, set: { if !$0 { dirtyReason = nil } }),
                            titleVisibility: .visible) {
            Button("Force remove — discard changes", role: .destructive) { Task { await remove(force: true) } }
        } message: { Text(dirtyReason ?? "") }
    }

    private func remove(force: Bool) async {
        busy = true; defer { busy = false }
        do {
            let r = try await model.client.request("worktrees.remove", ["path": row.path, "force": force], as: WorktreeRemoveResult.self)
            done(r.removed ? "removed \(row.branch.isEmpty ? row.path : row.branch)" : "not removed")
            dismiss()
        } catch let e as BridgeError where e.code == "DIRTY_WORKTREE" && !force {
            dirtyReason = e.message // second, explicit confirm with git's own reason
        } catch let e as BridgeError {
            error = e.message.isEmpty ? e.code : e.message
        } catch { self.error = error.localizedDescription }
    }

    private func land(_ strategy: String) async {
        guard let taskId = row.taskId else { return }
        busy = true; defer { busy = false }
        do {
            let r = try await model.client.request("task.land", ["taskId": taskId, "strategy": strategy], as: TaskLandResult.self)
            done("landed on \(r.landedOn) (\(r.commit.prefix(8)))")
            dismiss()
        } catch { self.error = error.localizedDescription }
    }
}
