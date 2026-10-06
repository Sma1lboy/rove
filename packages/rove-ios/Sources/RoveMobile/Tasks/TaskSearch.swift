import Foundation

/// Case-insensitive subsequence matching with a score, for the list's search field.
/// The TUI's `fuzzyMatch` (`sidebar/fuzzy.ts`) is the same subsequence test without scoring;
/// the phone ranks survivors so the best hit is first.
enum FuzzyMatch {
    private static let hit = 16
    private static let consecutive = 12
    private static let atStart = 8
    private static let atBoundary = 8
    private static let exact = 20

    /// nil = `query` is not a subsequence of `text`. Higher = better: consecutive runs, word starts
    /// (`/ - _ . space`), a prefix and an exact match score up; gaps and a late first hit score down.
    /// An empty query matches everything with 0.
    static func score(_ query: String, in text: String) -> Int? {
        let q = Array(query.lowercased()), h = Array(text.lowercased())
        if q.isEmpty { return 0 }
        guard q.count <= h.count else { return nil }
        var best: Int?
        for start in h.indices where h[start] == q[0] {
            if h.count - start < q.count { break }
            var qi = 0, prev = -2, s = 0, hi = start
            while hi < h.count, qi < q.count {
                if h[hi] == q[qi] {
                    s += hit
                    if hi == prev + 1 { s += consecutive }
                    if hi == 0 { s += atStart } else if isBoundary(h[hi - 1]) { s += atBoundary }
                    if prev >= 0, hi > prev + 1 { s -= 2 * min(hi - prev - 1, 3) }
                    prev = hi
                    qi += 1
                }
                hi += 1
            }
            guard qi == q.count else { continue }
            s -= min(start, 10)
            if h.count == q.count { s += exact }
            best = max(best ?? s, s)
        }
        return best
    }

    private static func isBoundary(_ c: Character) -> Bool { !(c.isLetter || c.isNumber) }
}

/// Which row fields the search reads, and how much each is worth.
/// Each field is matched on its own, never joined: a joined string would let `feat/tree` match a
/// `feat/chat` row by spending `tree` on the title next to it (the TUI's `tree-search.ts` rule).
/// Documented gap: the TUI's `/` also matches tab titles; task rows do not carry them.
enum RowSearch {
    /// Best field score for `row`, or nil when no field matches. Title beats branch beats repo.
    static func score(_ query: String, _ row: TaskRow) -> Int? {
        let fields: [(text: String, bonus: Int)] = [
            (row.displayTitle, 6), (row.branch, 2), (row.repoName, 0), (row.repo, -4),
        ]
        return fields.compactMap { f in
            f.text.isEmpty ? nil : FuzzyMatch.score(query, in: f.text).map { $0 + f.bonus }
        }.max()
    }
}
