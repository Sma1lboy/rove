import SwiftUI

enum DiffScope {
    /// The header words for a scope: what is being compared, with the base named.
    static func title(_ scope: String, base: String?) -> String {
        scope == "branch" ? "branch vs \(base ?? "base")" : "uncommitted"
    }
}

/// One file: its diff (or read-only content), with every hunkless or failed state spelled out.
struct DiffFileView: View {
    let taskId: String
    let path: String
    /// `working` or `branch`; a file opened from Files·All uses `working`.
    let scope: String
    var base: String?
    var review: ReviewStore
    /// Insert `@path` into the engine input (F6): the owner parks it and leaves this screen.
    var mention: (String) -> Void
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var phase: Phase = .loading
    @State private var selection = DiffSelection()
    @State private var composer: Composer?
    @State private var notesOpen = false

    enum Phase: Equatable { case loading, loaded(DiffFileResult), failed(String) }
    struct Composer: Identifiable { var id = UUID(); var rows: [DiffLine]; var range: (line: Int, startLine: Int?) }

    private var lines: [DiffLine] {
        guard case .loaded(let r) = phase else { return [] }
        return r.kind == "diff" ? DiffParser.lines(r.text ?? "") : DiffParser.codeLines(r.text ?? "")
    }

    var body: some View {
        VStack(spacing: 0) {
            ScreenHeader(back: { dismiss() }) {
                VStack(alignment: .leading, spacing: 2) {
                    Text((path as NSString).lastPathComponent).font(Theme.face(16, .semibold)).foregroundStyle(Theme.ink).lineLimit(1)
                    Text(path).font(Theme.mono(11)).foregroundStyle(Theme.muted).lineLimit(1).truncationMode(.head)
                }
            } trailing: {
                HStack(spacing: 0) {
                    Button { mention(path) } label: { Text("@").font(Theme.mono(17, .medium)).foregroundStyle(Theme.muted).frame(width: 36, height: 36) }
                        .buttonStyle(.pressable).accessibilityLabel("Mention in engine").accessibilityIdentifier("mentionButton")
                    Button { Task { await load() } } label: { HeaderIcon(systemName: "arrow.clockwise") }
                        .buttonStyle(.pressable).accessibilityLabel("Refresh").accessibilityIdentifier("refreshButton")
                }
            }
            metaStrip
            content
            if !selection.isEmpty { selectionBar }
        }
        .background(Theme.paper.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .task { await load(); await review.load() }
        .sheet(item: $composer) { c in
            NoteComposerSheet(file: path, lines: c.rows, range: c.range, review: review) { selection = DiffSelection() }
        }
        .sheet(isPresented: $notesOpen) { NotesSheet(review: review) }
    }

    // MARK: Header strip

    private var metaStrip: some View {
        HStack(spacing: 8) {
            Text(DiffScope.title(scope, base: base)).font(Theme.mono(11, .medium)).foregroundStyle(Theme.muted)
            if case .loaded(let r) = phase {
                if let from = r.origPath {
                    Text("·").font(Theme.mono(11)).foregroundStyle(Theme.muted)
                    Text("renamed from \(from)").font(Theme.mono(11)).foregroundStyle(Theme.muted).lineLimit(1).truncationMode(.head)
                }
                if r.kind == "diff" {
                    let c = DiffFileState.counts(r.text ?? "")
                    Spacer(minLength: 4)
                    Text("+\(c.added)").foregroundStyle(Theme.success)
                    Text("−\(c.deleted)").foregroundStyle(Theme.error)
                } else if r.kind == "code" {
                    Text("·").font(Theme.mono(11)).foregroundStyle(Theme.muted)
                    Text("read-only").font(Theme.mono(11)).foregroundStyle(Theme.muted)
                }
            }
            Spacer(minLength: 4)
            if !review.notes.isEmpty {
                Button { notesOpen = true } label: {
                    Text("notes \(review.unsent.count)/\(review.notes.count)").font(Theme.mono(11, .medium)).foregroundStyle(Theme.accent)
                }
                .buttonStyle(.pressable).accessibilityIdentifier("notesButton")
            }
        }
        .font(Theme.mono(12, .medium)).monospacedDigit()
        .padding(.horizontal, 20).padding(.bottom, 8)
        .overlay(alignment: .bottom) { Rectangle().fill(Theme.line).frame(height: 1) }
    }

    // MARK: Body by state

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
            } else if let state = DiffFileState.describe(r) {
                VStack(alignment: .leading, spacing: 4) {
                    EmptyState(title: state.title, detail: state.detail ?? "")
                }
                .padding(20).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            } else {
                DiffLinesView(lines: lines, file: path, notes: review.notes(in: path), selection: $selection,
                              selectable: r.kind == "diff")
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

    private var selectionBar: some View {
        let range = DiffParser.range(lines, cursor: selection.cursor ?? 0, anchor: selection.anchor)
        return HStack(spacing: 10) {
            Text(range.map { r in r.startLine.map { "lines \($0)–\(r.line)" } ?? "line \(r.line)" } ?? "")
                .font(Theme.mono(12, .medium)).foregroundStyle(Theme.ink)
            Spacer()
            Button { selection = DiffSelection() } label: { Text("clear").font(Theme.mono(13)).foregroundStyle(Theme.muted).frame(minHeight: 40) }
                .buttonStyle(.pressable)
            Button {
                guard let range, let a = selection.anchor, let c = selection.cursor else { return }
                composer = Composer(rows: Array(lines[min(a, c)...max(a, c)]), range: range)
            } label: {
                Text("note").font(Theme.mono(13, .semibold)).foregroundStyle(Theme.paper)
                    .padding(.horizontal, 16).frame(height: 38)
                    .background(Theme.accent, in: RoundedRectangle(cornerRadius: Theme.smallRadius, style: .continuous))
            }
            .buttonStyle(.pressable).accessibilityIdentifier("addNote")
        }
        .padding(.horizontal, 20).padding(.vertical, 8)
        .background(Theme.paper)
        .overlay(alignment: .top) { Rectangle().fill(Theme.line).frame(height: 1) }
    }

    private func load() async {
        phase = .loading
        selection = DiffSelection()
        do {
            let r = try await model.client.request("diff.file", ["taskId": taskId, "path": path, "scope": scope], as: DiffFileResult.self)
            phase = .loaded(r)
        } catch { phase = .failed(error.localizedDescription) }
    }
}
