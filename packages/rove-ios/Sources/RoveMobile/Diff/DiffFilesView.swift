import SwiftUI

/// The files screen for one task: `changes` (what differs, scoped and named) and `all` (browse the
/// worktree). Opened from the task's diff chip.
struct DiffFilesView: View {
    let taskId: String
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var tab = "changes"
    @State private var scope = "working"
    @State private var base: String?
    @State private var files: [DiffFile] = []
    @State private var loaded = false
    @State private var error: String?
    @State private var review: ReviewStore?
    @State private var notesOpen = false
    @State private var refresh = 0

    private var visible: [DiffFile] { files.filter { $0.scope == scope } }

    var body: some View {
        VStack(spacing: 0) {
            ScreenHeader(back: { dismiss() }) {
                Text("files").font(Theme.face(16, .semibold)).foregroundStyle(Theme.ink)
            } trailing: {
                HStack(spacing: 0) {
                    if let review, !review.notes.isEmpty {
                        Button { notesOpen = true } label: {
                            Text("notes \(review.unsent.count)/\(review.notes.count)").font(Theme.mono(12, .medium))
                                .foregroundStyle(Theme.accent).padding(.horizontal, 8).frame(height: 36)
                        }
                        .buttonStyle(.pressable).accessibilityIdentifier("notesButton")
                    }
                    Button { refresh += 1; Task { await load() } } label: { HeaderIcon(systemName: "arrow.clockwise") }
                        .buttonStyle(.pressable).accessibilityLabel("Refresh").accessibilityIdentifier("refreshButton")
                }
            }
            ChoiceTiles(options: ["changes", "all"], selection: $tab) { $0 == "changes" ? String(localized: "changes") : String(localized: "all") }
                .padding(.horizontal, 20).padding(.bottom, 10)
            if tab == "changes" { changes } else {
                FileTreeView(taskId: taskId, review: review ?? ReviewStore(client: model.client, taskId: taskId), base: base,
                             refresh: refresh, mention: mention)
            }
        }
        .background(Theme.paper.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .task {
            if review == nil { review = ReviewStore(client: model.client, taskId: taskId) }
            await load()
            await review?.load()
        }
        .sheet(isPresented: $notesOpen) { if let review { NotesSheet(review: review) } }
    }

    /// F6: park `@path` for the engine input, then leave so the task's terminal is what you see.
    private func mention(_ path: String) {
        MentionBus.shared.post(taskId: taskId, path: path)
        // The file view pops itself first; a pop issued while it is still on top is ignored.
        Task { try? await Task.sleep(for: .milliseconds(500)); dismiss() }
    }

    // MARK: Changes

    private var changes: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if let error {
                    ErrorLine(text: error).accessibilityIdentifier("filesError")
                    Button { Task { await load() } } label: { TileLabel(text: String(localized: "retry"), tint: Theme.accent) }
                        .buttonStyle(.pressable).accessibilityIdentifier("retryButton")
                } else {
                    scopeHeader
                    if !loaded {
                        HStack(spacing: 8) { BrailleSpinner(size: 14, tint: Theme.muted); Text("loading").font(Theme.mono(12)).foregroundStyle(Theme.muted) }
                    } else if visible.isEmpty {
                        EmptyState(title: String(localized: "no changes"), detail: emptyDetail)
                    } else {
                        combinedRow(path: ".", title: String(localized: "whole worktree"),
                                    detail: visible.count == 1 ? String(localized: "all \(visible.count) file as one diff") : String(localized: "all \(visible.count) files as one diff"))
                        ForEach(ChangeGroup.group(visible)) { g in group(g) }
                    }
                }
            }
            .padding(.horizontal, 20).padding(.bottom, 24)
        }
        .refreshable { await load() }
    }

    private var emptyDetail: String {
        scope == "working" ? String(localized: "the worktree matches its last commit") : String(localized: "nothing on this branch beyond \(base ?? String(localized: "its base"))")
    }

    /// What this list is: working changes vs the branch against its named base.
    private var scopeHeader: some View {
        VStack(alignment: .leading, spacing: 8) {
            ChoiceTiles(options: base == nil ? ["working"] : ["working", "branch"], selection: $scope) { DiffScope.title($0, base: base) }
            Text(scope == "working" ? String(localized: "edits not committed yet in this task's worktree") : String(localized: "commits on this branch since it left \(base ?? String(localized: "its base")); uncommitted edits are under the other tab"))
                .font(Theme.mono(12)).foregroundStyle(Theme.muted).fixedSize(horizontal: false, vertical: true)
        }
    }

    private func combinedRow(path: String, title: String, detail: String) -> some View {
        NavigationLink {
            CombinedDiffView(taskId: taskId, path: path, base: base, scope: scope)
        } label: {
            HStack {
                Text(title).font(Theme.mono(13, .semibold)).foregroundStyle(Theme.accent)
                Spacer()
                Text(detail).font(Theme.mono(11)).foregroundStyle(Theme.muted).lineLimit(1)
            }
            .padding(.horizontal, 12).frame(minHeight: 44).tile(Theme.accentSoft, border: Theme.accent)
        }
        .buttonStyle(.pressable)
        .accessibilityIdentifier(path == "." ? "combinedAll" : "combined-\(path)")
    }

    private func group(_ g: ChangeGroup) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            if g.dir.isEmpty == false {
                combinedRow(path: g.dir, title: g.dir, detail: g.files.count == 1 ? String(localized: "\(g.files.count) file · combined") : String(localized: "\(g.files.count) files · combined"))
            }
            VStack(spacing: 0) {
                ForEach(g.files) { f in
                    NavigationLink {
                        DiffFileView(taskId: taskId, path: f.path, scope: f.scope, base: base,
                                     review: review ?? ReviewStore(client: model.client, taskId: taskId), mention: mention)
                    } label: { fileRow(f, inGroup: !g.dir.isEmpty) }
                    .buttonStyle(RowButtonStyle())
                    .accessibilityIdentifier("file-\(f.path)")
                }
            }
            .tile()
        }
    }

    private func fileRow(_ f: DiffFile, inGroup: Bool) -> some View {
        HStack(spacing: 10) {
            Text(f.status).font(Theme.mono(12, .semibold)).foregroundStyle(statusColor(f.status)).frame(width: 18)
            Text(inGroup ? (f.path as NSString).lastPathComponent : f.path)
                .font(Theme.mono(13)).foregroundStyle(Theme.ink).lineLimit(1).truncationMode(.head)
            Spacer(minLength: 6)
            if let a = f.added { Text("+\(a)").foregroundStyle(Theme.success) }
            if let d = f.deleted { Text("−\(d)").foregroundStyle(Theme.error) }
        }
        .font(Theme.mono(12)).monospacedDigit()
        .padding(.horizontal, 12).frame(minHeight: 44)
    }

    private func statusColor(_ s: String) -> Color { s == "D" ? Theme.error : s == "A" || s == "?" ? Theme.success : Theme.muted }

    private func load() async {
        do {
            let r = try await model.client.request("diff.files", ["taskId": taskId], as: DiffFilesResult.self)
            base = r.base; files = r.files; error = nil
            if !r.files.contains(where: { $0.scope == scope }), let other = r.files.first?.scope { scope = other }
        } catch { self.error = error.localizedDescription }
        loaded = true
    }
}

/// Changed files grouped by directory; a root file has no group header.
struct ChangeGroup: Identifiable, Equatable {
    var dir: String
    var files: [DiffFile]
    var id: String { dir }

    static func group(_ files: [DiffFile]) -> [ChangeGroup] {
        let dirs = Dictionary(grouping: files) { FileTreeLogic.parent(of: $0.path) }
        return dirs.keys.sorted { $0.localizedStandardCompare($1) == .orderedAscending }
            .map { ChangeGroup(dir: $0, files: dirs[$0] ?? []) }
    }
}
