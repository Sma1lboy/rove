import SwiftUI

/// Files · All: browse the task's worktree one directory at a time (tracked and untracked, ignored
/// files left out — the TUI's file list), search by path, open any file as a read-only preview.
struct FileTreeView: View {
    let taskId: String
    var review: ReviewStore
    var base: String?
    /// Bumped by the parent's refresh button.
    var refresh: Int
    var mention: (String) -> Void
    @Environment(AppModel.self) private var model
    @State private var files: [String] = []
    @State private var truncated = false
    @State private var loaded = false
    @State private var error: String?
    @State private var dir = ""
    @State private var query = ""

    var body: some View {
        VStack(spacing: 0) {
            FieldBox { TextField("search paths", text: $query).accessibilityIdentifier("pathSearch") }
                .padding(.horizontal, 20).padding(.bottom, 8)
            if query.trimmingCharacters(in: .whitespaces).isEmpty { crumbBar }
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if let error {
                        ErrorLine(text: error).accessibilityIdentifier("filesError")
                        Button { Task { await load() } } label: { TileLabel(text: "retry", tint: Theme.accent) }
                            .buttonStyle(.pressable).accessibilityIdentifier("retryButton")
                    } else if !loaded {
                        HStack(spacing: 8) { BrailleSpinner(size: 14, tint: Theme.muted); Text("loading").font(Theme.mono(12)).foregroundStyle(Theme.muted) }
                    } else {
                        list
                    }
                }
                .padding(.horizontal, 20).padding(.bottom, 24)
            }
            .refreshable { await load() }
        }
        .task { await load() }
        .onChange(of: refresh) { Task { await load() } }
    }

    @ViewBuilder private var list: some View {
        let searching = !query.trimmingCharacters(in: .whitespaces).isEmpty
        if searching {
            let hits = FileTreeLogic.search(files, query)
            if hits.isEmpty { EmptyState(title: "no match", detail: "no path contains “\(query)”") }
            VStack(spacing: 0) { ForEach(hits, id: \.self) { fileLink($0, label: $0) } }.tile()
        } else {
            let entries = FileTreeLogic.entries(files, in: dir)
            if entries.isEmpty { EmptyState(title: "empty", detail: "no files here") }
            VStack(spacing: 0) {
                ForEach(entries) { e in
                    if case .dir(let n) = e.kind { dirRow(e, files: n) } else { fileLink(e.path, label: e.name) }
                }
            }
            .tile()
            if truncated { Text("list capped — search to reach the rest").font(Theme.mono(11)).foregroundStyle(Theme.muted) }
        }
    }

    private var crumbBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                Button { dir = "" } label: { Text("worktree").foregroundStyle(dir.isEmpty ? Theme.ink : Theme.accent) }
                    .buttonStyle(.pressable)
                ForEach(FileTreeLogic.crumbs(dir), id: \.path) { c in
                    Text("/").foregroundStyle(Theme.muted)
                    Button { dir = c.path } label: { Text(c.name).foregroundStyle(c.path == dir ? Theme.ink : Theme.accent) }
                        .buttonStyle(.pressable)
                }
            }
            .font(Theme.mono(12, .medium))
            .padding(.horizontal, 20).frame(height: 32)
        }
        .padding(.bottom, 4)
    }

    private func dirRow(_ e: TreeEntry, files n: Int) -> some View {
        HStack(spacing: 0) {
            Button { withAnimation(Theme.spring) { dir = e.path } } label: {
                HStack {
                    Text(e.name + "/").font(Theme.mono(13, .medium)).foregroundStyle(Theme.ink).lineLimit(1)
                    Spacer(minLength: 6)
                    Text("\(n)").font(Theme.mono(11)).foregroundStyle(Theme.muted)
                }
                .padding(.leading, 12).frame(minHeight: 44).contentShape(Rectangle())
            }
            .buttonStyle(RowButtonStyle())
            .accessibilityIdentifier("dir-\(e.path)")
            NavigationLink { CombinedDiffView(taskId: taskId, path: e.path, base: base, scope: "working") } label: {
                Text("diff").font(Theme.mono(12)).foregroundStyle(Theme.accent).padding(.horizontal, 12).frame(minHeight: 44)
            }
            .buttonStyle(RowButtonStyle())
            .accessibilityIdentifier("dirDiff-\(e.path)")
        }
    }

    private func fileLink(_ path: String, label: String) -> some View {
        NavigationLink {
            DiffFileView(taskId: taskId, path: path, scope: "working", base: base, review: review, mention: mention)
        } label: {
            HStack {
                Text(label).font(Theme.mono(13)).foregroundStyle(Theme.ink).lineLimit(1).truncationMode(.head)
                Spacer()
            }
            .padding(.horizontal, 12).frame(minHeight: 44).contentShape(Rectangle())
        }
        .buttonStyle(RowButtonStyle())
        .accessibilityIdentifier("tree-\(path)")
    }

    private func load() async {
        do {
            let r = try await model.client.request("files.list", ["taskId": taskId], as: FilesListResult.self)
            files = r.files; truncated = r.truncated ?? false; error = nil
        } catch { self.error = error.localizedDescription }
        loaded = true
    }
}
