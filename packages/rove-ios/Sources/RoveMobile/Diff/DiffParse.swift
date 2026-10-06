import SwiftUI

enum DiffLineKind: Equatable {
    case added, removed, hunk, meta, context

    /// Header-only classification of a bare line (no hunk state). `DiffParser` is state-aware and
    /// is what the views use, so a removed line that starts `--` is not mistaken for a header.
    static func classify(_ line: String) -> DiffLineKind {
        if line.hasPrefix("+++") || line.hasPrefix("---") || line.hasPrefix("diff ") || line.hasPrefix("index ") { return .meta }
        if line.hasPrefix("@@") { return .hunk }
        if line.hasPrefix("+") { return .added }
        if line.hasPrefix("-") { return .removed }
        return .context
    }

    /// Additions success green, deletions error red (owner-approved); headers stay quiet.
    var color: Color {
        switch self {
        case .added: Theme.success
        case .removed: Theme.error
        case .hunk: Theme.accent
        case .meta: Theme.muted
        case .context: Theme.ink
        }
    }

    var wash: Color {
        switch self {
        case .added: Theme.success.opacity(0.14)
        case .removed: Theme.error.opacity(0.13)
        case .hunk: Theme.inset
        case .meta, .context: .clear
        }
    }
}

/// One displayed line of a unified diff. `number` is the gutter number the TUI shows (new-file
/// for added/context rows, old-file for removed rows), `nil` for headers.
struct DiffLine: Identifiable, Equatable {
    var id: Int
    var kind: DiffLineKind
    var text: String
    var number: Int?
    /// Only hunk body rows (+, −, context) can carry a review note.
    var selectable: Bool { number != nil }
}

enum DiffParser {
    private static func hunkStarts(_ line: String) -> (old: Int, new: Int)? {
        // @@ -a[,b] +c[,d] @@
        guard line.hasPrefix("@@ -") else { return nil }
        let parts = line.dropFirst(3).split(separator: " ", omittingEmptySubsequences: true)
        guard parts.count >= 2, parts[0].hasPrefix("-"), parts[1].hasPrefix("+") else { return nil }
        func first(_ s: Substring) -> Int? { Int(s.dropFirst().split(separator: ",").first ?? "") }
        guard let o = first(parts[0]), let n = first(parts[1]) else { return nil }
        return (o, n)
    }

    /// Mirrors `unifiedDiffRows` in the TUI so a note's line numbers mean the same on both sides.
    static func lines(_ text: String) -> [DiffLine] {
        var out: [DiffLine] = []
        var oldLine = 0, newLine = 0
        var inHunk = false
        var parts = text.components(separatedBy: "\n")
        if parts.last == "" { parts.removeLast() } // the patch's trailing newline is not a row
        for (i, raw) in parts.enumerated() {
            if let h = hunkStarts(raw) {
                oldLine = h.old; newLine = h.new; inHunk = true
                out.append(DiffLine(id: i, kind: .hunk, text: raw, number: nil))
                continue
            }
            if inHunk {
                switch raw.first {
                case "+": out.append(DiffLine(id: i, kind: .added, text: raw, number: newLine)); newLine += 1; continue
                case "-": out.append(DiffLine(id: i, kind: .removed, text: raw, number: oldLine)); oldLine += 1; continue
                case " ", nil: out.append(DiffLine(id: i, kind: .context, text: raw, number: newLine)); oldLine += 1; newLine += 1; continue
                case "\\": out.append(DiffLine(id: i, kind: .meta, text: raw, number: nil)); continue
                default: inHunk = false
                }
            }
            out.append(DiffLine(id: i, kind: .meta, text: raw, number: nil))
        }
        return out
    }

    /// The range a note anchored at `anchor`..`cursor` (indices into `rows`) records. Mixed +/- rows
    /// have non-monotonic numbers; a range that does not order cleanly collapses to the end line.
    static func range(_ rows: [DiffLine], cursor: Int, anchor: Int?) -> (line: Int, startLine: Int?)? {
        guard rows.indices.contains(cursor), let end = rows[cursor].number else { return nil }
        guard let anchor, anchor != cursor, rows.indices.contains(anchor) else { return (end, nil) }
        let lo = rows[min(anchor, cursor)], hi = rows[max(anchor, cursor)]
        guard let a = lo.number, let b = hi.number, a < b else { return (end, nil) }
        return (b, a)
    }

    /// Whether `note` covers display line `number` of `file` (for the in-diff marker).
    static func covers(_ note: ReviewNote, file: String, number: Int) -> Bool {
        note.filePath == file && number >= (note.startLine ?? note.line) && number <= note.line
    }
}

/// One file's slice of a multi-file patch (a directory or whole-worktree diff).
struct DiffSection: Identifiable, Equatable {
    var path: String
    var text: String
    var added: Int
    var deleted: Int
    var id: String { path }
}

enum CombinedDiff {
    /// Split on `diff --git` headers. The path is the b side, which is where a rename now lives.
    static func sections(_ patch: String) -> [DiffSection] {
        var out: [DiffSection] = []
        var path: String?
        var buf: [String] = []
        func flush() {
            if let p = path { out.append(section(p, buf)) }
            buf = []
        }
        for line in patch.components(separatedBy: "\n") {
            if line.hasPrefix("diff --git ") {
                flush()
                path = bPath(line)
            }
            buf.append(line)
        }
        flush()
        return out
    }

    private static func section(_ path: String, _ lines: [String]) -> DiffSection {
        var added = 0, deleted = 0
        for l in DiffParser.lines(lines.joined(separator: "\n")) {
            if l.kind == .added { added += 1 } else if l.kind == .removed { deleted += 1 }
        }
        return DiffSection(path: path, text: lines.joined(separator: "\n"), added: added, deleted: deleted)
    }

    /// `diff --git a/x b/y` → `y`. Quoted and spaced names fall back to the text after ` b/`.
    private static func bPath(_ header: String) -> String {
        let rest = String(header.dropFirst("diff --git ".count))
        if let r = rest.range(of: " b/", options: .backwards) { return String(rest[r.upperBound...]).trimmingCharacters(in: CharacterSet(charactersIn: "\"")) }
        return rest
    }
}
