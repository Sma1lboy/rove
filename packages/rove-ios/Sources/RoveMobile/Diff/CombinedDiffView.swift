import SwiftUI

/// F4: every change under a directory (`dir/`) or the whole worktree (`.`) as one read-only diff.
/// The pathspec form is the TUI's own (`rove ops --preview`), so git produces the combined patch.
struct CombinedDiffView: View {
    let taskId: String
    /// `.` for the whole worktree, else a directory ending in `/`.
    let path: String
    var base: String?
    @State var scope: String
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var phase: DiffFileView.Phase = .loading
    @State private var selection = DiffSelection()

    private var title: String { path == "." ? "whole worktree" : path }
    private var scopes: [String] { base == nil ? ["working"] : ["working", "branch"] }

    init(taskId: String, path: String, base: String?, scope: String) {
        self.taskId = taskId; self.path = path; self.base = base
        _scope = State(initialValue: scope)
    }

    var body: some View {
        VStack(spacing: 0) {
            ScreenHeader(back: { dismiss() }) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("combined diff").font(Theme.face(16, .semibold)).foregroundStyle(Theme.ink)
                    Text(title).font(Theme.mono(11)).foregroundStyle(Theme.muted).lineLimit(1).truncationMode(.head)
                }
            } trailing: {
                Button { Task { await load() } } label: { HeaderIcon(systemName: "arrow.clockwise") }
                    .buttonStyle(.pressable).accessibilityLabel("Refresh").accessibilityIdentifier("refreshButton")
            }
            VStack(alignment: .leading, spacing: 8) {
                ChoiceTiles(options: scopes, selection: $scope) { DiffScope.title($0, base: base) }
                summary
            }
            .padding(.horizontal, 20).padding(.bottom, 10)
            .overlay(alignment: .bottom) { Rectangle().fill(Theme.line).frame(height: 1) }
            content
        }
        .background(Theme.paper.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .task(id: scope) { await load() }
    }

    @ViewBuilder private var summary: some View {
        if case .loaded(let r) = phase, r.kind == "diff" {
            let sections = CombinedDiff.sections(r.text ?? "")
            HStack(spacing: 8) {
                Text("\(sections.count) \(sections.count == 1 ? "file" : "files")").foregroundStyle(Theme.muted)
                Text("+\(sections.reduce(0) { $0 + $1.added })").foregroundStyle(Theme.success)
                Text("−\(sections.reduce(0) { $0 + $1.deleted })").foregroundStyle(Theme.error)
                Spacer()
                Text("read-only").foregroundStyle(Theme.muted)
            }
            .font(Theme.mono(12, .medium)).monospacedDigit()
        } else {
            Text("read-only · tracked changes only").font(Theme.mono(12)).foregroundStyle(Theme.muted)
        }
    }

    @ViewBuilder private var content: some View {
        switch phase {
        case .loading:
            HStack(spacing: 8) { BrailleSpinner(size: 14, tint: Theme.muted); Text("loading").font(Theme.mono(12)).foregroundStyle(Theme.muted) }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let message):
            failure(message)
        case .loaded(let r):
            if r.kind == "error" {
                failure(r.message ?? "git gave no reason")
            } else if r.kind == "diff" {
                DiffLinesView(lines: DiffParser.lines(r.text ?? ""), file: path, selection: $selection, selectable: false)
            } else {
                EmptyState(title: "no changes", detail: "nothing under \(title) differs in this scope")
                    .padding(20).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
        }
    }

    private func failure(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            ErrorLine(text: message).accessibilityIdentifier("diffError")
            Button { Task { await load() } } label: { TileLabel(text: "retry", tint: Theme.accent) }
                .buttonStyle(.pressable).accessibilityIdentifier("retryButton")
        }
        .padding(20).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func load() async {
        phase = .loading
        do {
            phase = .loaded(try await model.client.request("diff.file", ["taskId": taskId, "path": path, "scope": scope], as: DiffFileResult.self))
        } catch { phase = .failed(error.localizedDescription) }
    }
}
