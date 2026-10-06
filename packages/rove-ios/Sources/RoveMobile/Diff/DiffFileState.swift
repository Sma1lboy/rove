import Foundation

/// What a `diff.file` result that is not a plain diff or file looks like to the person reading it.
/// A hunkless patch must never render as an empty page: blank reads as "nothing changed".
struct DiffFileState: Equatable {
    var title: String
    var detail: String?

    static func size(_ bytes: Int?) -> String? {
        guard let bytes else { return nil }
        return ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file).lowercased()
    }

    /// `nil` for `diff` and `code`, which render as text. Errors are shown by the caller verbatim.
    static func describe(_ r: DiffFileResult) -> DiffFileState? {
        switch r.kind {
        case "binary":
            return DiffFileState(title: r.image == true ? String(localized: "image") : String(localized: "binary file"),
                                 detail: [size(r.sizeBytes), String(localized: "no text preview")].compactMap { $0 }.joined(separator: " · "))
        case "empty":
            return DiffFileState(title: String(localized: "no changes"), detail: String(localized: "nothing differs in this scope"))
        case "patch-note":
            guard let n = r.note else { return DiffFileState(title: String(localized: "changed"), detail: String(localized: "no hunks to show")) }
            let from = n.from ?? "?", to = n.to ?? "?"
            switch n.kind {
            case "binary":
                return DiffFileState(title: String(localized: "binary file changed"), detail: [size(r.sizeBytes), String(localized: "no text diff")].compactMap { $0 }.joined(separator: " · "))
            case "mode":
                return DiffFileState(title: String(localized: "mode changed"), detail: String(localized: "\(from) → \(to) · contents unchanged"))
            case "rename":
                return DiffFileState(title: String(localized: "renamed"), detail: String(localized: "\(from) → \(to) · +0 −0, contents unchanged"))
            case "empty-file":
                return DiffFileState(title: n.change == "deleted" ? String(localized: "empty file deleted") : String(localized: "empty file added"), detail: String(localized: "no lines to show"))
            default:
                return DiffFileState(title: String(localized: "changed"), detail: String(localized: "no hunks to show"))
            }
        default:
            return nil
        }
    }

    /// `+N −M` of a unified diff, from its own rows.
    static func counts(_ text: String) -> (added: Int, deleted: Int) {
        var a = 0, d = 0
        for l in DiffParser.lines(text) {
            if l.kind == .added { a += 1 } else if l.kind == .removed { d += 1 }
        }
        return (a, d)
    }
}

extension DiffParser {
    /// A plain file as numbered, unselectable rows.
    static func codeLines(_ text: String) -> [DiffLine] {
        var parts = text.components(separatedBy: "\n")
        if parts.last == "" { parts.removeLast() }
        return parts.enumerated().map { DiffLine(id: $0.offset, kind: .context, text: $0.element, number: $0.offset + 1) }
    }
}
