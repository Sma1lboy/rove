import Foundation

/// One row when browsing a worktree one directory at a time.
struct TreeEntry: Identifiable, Equatable {
    enum Kind: Equatable { case dir(files: Int), file }
    var name: String
    /// Worktree-relative; directories end in `/` (the combined-diff pathspec form).
    var path: String
    var kind: Kind
    var id: String { path }
    var isDir: Bool { if case .dir = kind { return true } else { return false } }
}

enum FileTreeLogic {
    /// The children of `dir` (`""` = root, otherwise `a/b/`), directories first, each group by name.
    static func entries(_ files: [String], in dir: String) -> [TreeEntry] {
        var dirs: [String: Int] = [:]
        var leaves: [TreeEntry] = []
        for f in files where f.hasPrefix(dir) {
            let rest = f.dropFirst(dir.count)
            if let slash = rest.firstIndex(of: "/") {
                dirs[String(rest[..<slash]), default: 0] += 1
            } else {
                leaves.append(TreeEntry(name: String(rest), path: f, kind: .file))
            }
        }
        let folders = dirs.keys.sorted { $0.localizedStandardCompare($1) == .orderedAscending }
            .map { TreeEntry(name: $0, path: dir + $0 + "/", kind: .dir(files: dirs[$0] ?? 0)) }
        return folders + leaves.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }

    /// `a/b/` → [("a", "a/"), ("b", "a/b/")]
    static func crumbs(_ dir: String) -> [(name: String, path: String)] {
        var acc = ""
        return dir.split(separator: "/").map { part in
            acc += part + "/"
            return (String(part), acc)
        }
    }

    /// Case-insensitive substring match over full paths, capped so a huge repo cannot flood the list.
    static func search(_ files: [String], _ query: String, limit: Int = 200) -> [String] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return [] }
        return Array(files.lazy.filter { $0.lowercased().contains(q) }.prefix(limit))
    }

    /// Directory of a worktree-relative file path in browse form (`""` for a root file).
    static func parent(of path: String) -> String {
        guard let slash = path.lastIndex(of: "/") else { return "" }
        return String(path[...slash])
    }
}
