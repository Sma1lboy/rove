import SwiftUI

enum DiffLineKind: Equatable {
    case added, removed, hunk, meta, context

    static func classify(_ line: String) -> DiffLineKind {
        if line.hasPrefix("+++") || line.hasPrefix("---") || line.hasPrefix("diff ") || line.hasPrefix("index ") { return .meta }
        if line.hasPrefix("@@") { return .hunk }
        if line.hasPrefix("+") { return .added }
        if line.hasPrefix("-") { return .removed }
        return .context
    }

    var color: Color {
        switch self {
        case .added: .green
        case .removed: .red
        case .hunk: .cyan
        case .meta: .secondary
        case .context: .primary
        }
    }
}

struct DiffFilesView: View {
    let taskId: String
    @Environment(AppModel.self) private var model
    @State private var base: String?
    @State private var files: [DiffFile] = []
    @State private var loaded = false
    @State private var error: String?

    private var scopes: [(title: String, scope: String)] {
        [("Committed vs base", "branch"), ("Uncommitted", "working")]
    }

    var body: some View {
        List {
            if let error { Text(error).foregroundStyle(.red).font(.footnote) }
            ForEach(scopes, id: \.scope) { s in
                let items = files.filter { $0.scope == s.scope }
                if !items.isEmpty {
                    Section(s.scope == "branch" ? "\(s.title)\(base.map { " (\($0))" } ?? "")" : s.title) {
                        ForEach(items) { f in
                            NavigationLink { DiffFileView(taskId: taskId, file: f) } label: { fileRow(f) }
                        }
                    }
                }
            }
            if loaded && files.isEmpty && error == nil { ContentUnavailableView("No changes", systemImage: "checkmark.circle") }
        }
        .navigationTitle("Diff")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task { await load() }
    }

    private func fileRow(_ f: DiffFile) -> some View {
        HStack {
            Text(f.status).font(.caption.monospaced().bold()).frame(width: 24)
            Text(f.path).font(.footnote.monospaced()).lineLimit(2).truncationMode(.head)
            Spacer()
            if let a = f.added { Text("+\(a)").foregroundStyle(.green).font(.caption.monospaced()) }
            if let d = f.deleted { Text("-\(d)").foregroundStyle(.red).font(.caption.monospaced()) }
        }
    }

    private func load() async {
        do {
            let r = try await model.client.request("diff.files", ["taskId": taskId], as: DiffFilesResult.self)
            base = r.base; files = r.files; error = nil
        } catch { self.error = error.localizedDescription }
        loaded = true
    }
}

struct DiffFileView: View {
    let taskId: String
    let file: DiffFile
    @Environment(AppModel.self) private var model
    @State private var result: DiffFileResult?
    @State private var error: String?

    var body: some View {
        Group {
            if let result { content(result) }
            else if let error { Text(error).foregroundStyle(.red).padding() }
            else { ProgressView() }
        }
        .navigationTitle((file.path as NSString).lastPathComponent)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            do {
                result = try await model.client.request("diff.file",
                    ["taskId": taskId, "path": file.path, "scope": file.scope], as: DiffFileResult.self)
            } catch { self.error = error.localizedDescription }
        }
    }

    @ViewBuilder private func content(_ r: DiffFileResult) -> some View {
        switch r.kind {
        case "diff", "code":
            let lines = (r.text ?? "").components(separatedBy: "\n")
            GeometryReader { geo in
                ScrollView([.horizontal, .vertical]) {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                            let kind = r.kind == "diff" ? DiffLineKind.classify(line) : .context
                            Text(line.isEmpty ? " " : line)
                                .font(.system(size: 12, design: .monospaced))
                                .foregroundStyle(kind.color)
                                .fixedSize(horizontal: true, vertical: false)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(kind == .added ? Color.green.opacity(0.12) : kind == .removed ? Color.red.opacity(0.12) : .clear)
                        }
                    }
                    .padding(8)
                    .frame(minWidth: geo.size.width, minHeight: geo.size.height, alignment: .topLeading)
                }
            }
        default:
            ContentUnavailableView(r.kind.capitalized, systemImage: "doc", description: Text(r.message ?? r.text ?? ""))
        }
    }
}
