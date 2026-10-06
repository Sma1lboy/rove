import SwiftUI

/// Colour intent of a row mark, kept out of SwiftUI so the formatting below is testable.
/// Terracotta (`accent`) is never an error; `error` is for failures and diff deletions only.
enum MarkTone: Equatable {
    case success, error, accent, ink, muted

    var color: Color {
        switch self {
        case .success: Theme.success
        case .error: Theme.error
        case .accent: Theme.accent
        case .ink: Theme.ink
        case .muted: Theme.muted
        }
    }
}

struct MarkSegment: Equatable {
    var text: String
    var tone: MarkTone
}

/// Pure formatting for the marks on a task row (the TUI's row chips, `sidebar/row-chips.ts`).
enum TaskRowMarks {
    static let pinned = "▴"

    /// `+N/−N` (success / muted slash / error) when the daemon counted lines; `?` when git failed
    /// (muted); nothing when `changes` is absent or has no counts.
    static func changes(_ c: TaskChanges?) -> [MarkSegment] {
        guard let c else { return [] }
        if c.isUnreadable { return [MarkSegment(text: "?", tone: .muted)] }
        guard c.hasLineCounts else { return [] }
        return [MarkSegment(text: "+\(c.added ?? 0)", tone: .success),
                MarkSegment(text: "/", tone: .muted),
                MarkSegment(text: "−\(c.deleted ?? 0)", tone: .error)]
    }

    /// `↑N/↓N` ahead (muted) / behind (accent) of base; only the non-zero side is drawn.
    static func aheadBehind(_ c: TaskChanges?) -> [MarkSegment] {
        guard let c, !c.isUnreadable else { return [] }
        var out: [MarkSegment] = []
        if let a = c.ahead, a > 0 { out.append(MarkSegment(text: "↑\(a)", tone: .muted)) }
        if let b = c.behind, b > 0 {
            if !out.isEmpty { out.append(MarkSegment(text: "/", tone: .muted)) }
            out.append(MarkSegment(text: "↓\(b)", tone: .accent))
        }
        return out
    }

    /// The row's PR chip kind. The bridge's `prChip` wins; an older bridge sends none, so the same
    /// rules (`row-chips.ts`) run over `pr`: CONFLICTING → conflict, failing → failing, passing → passing.
    static func chipKind(_ row: TaskRow) -> String? {
        if let k = row.prChip { return k }
        return row.pr.flatMap(chipKind)
    }

    static func chipKind(_ pr: TaskPR) -> String? {
        if (pr.mergeable ?? "").uppercased() == "CONFLICTING" { return "conflict" }
        switch pr.checkState.lowercased() {
        case "failing": return "failing"
        case "passing": return "passing"
        default: return nil
        }
    }

    /// `≠` conflict / `✗` failing (error), `✓` passing (success); muted when the PR status is stale.
    static func prMark(kind: String?, stale: Bool) -> MarkSegment? {
        let mark: (String, MarkTone)
        switch kind {
        case "conflict": mark = ("≠", .error)
        case "failing": mark = ("✗", .error)
        case "passing": mark = ("✓", .success)
        default: return nil
        }
        return MarkSegment(text: mark.0, tone: stale ? .muted : mark.1)
    }

    static func prNumber(_ pr: TaskPR?) -> String? { pr?.number.map { "#\($0)" } }

    /// Tokens still alive at `now` (the phone filters; the bridge only drops them on republish).
    static func liveTokens(_ tokens: [RowTokenChip], now: Date) -> [RowTokenChip] {
        tokens.filter { $0.isLive(now: now) && !$0.text.isEmpty }
    }

    /// Plugin token tone → colour intent: success, error as named; info/warning read as ink
    /// (never accent, never error); no tone or an unknown one is muted.
    static func tokenTone(_ tone: String?) -> MarkTone {
        switch tone?.lowercased() {
        case "success": .success
        case "error": .error
        case "info", "warning", "warn": .ink
        default: .muted
        }
    }
}

/// Mono segments in one line, each in its own tone.
struct MarkText: View {
    var segments: [MarkSegment]
    var size: CGFloat = 11

    var body: some View {
        HStack(spacing: 0) {
            ForEach(Array(segments.enumerated()), id: \.offset) { _, s in
                Text(s.text).foregroundStyle(s.tone.color)
            }
        }
        .font(Theme.mono(size, .medium))
        .lineLimit(1)
        .fixedSize()
    }
}

/// Live plugin tokens as small mono tags.
struct RowTokenTags: View {
    var tokens: [RowTokenChip]

    var body: some View {
        HStack(spacing: 4) {
            ForEach(Array(tokens.enumerated()), id: \.offset) { _, t in
                Text(t.text)
                    .font(Theme.mono(10, .medium))
                    .foregroundStyle(TaskRowMarks.tokenTone(t.tone).color)
                    .lineLimit(1)
                    .padding(.horizontal, 5).padding(.vertical, 1)
                    .background(Theme.inset, in: RoundedRectangle(cornerRadius: 4, style: .continuous))
            }
        }
        .fixedSize()
    }
}
