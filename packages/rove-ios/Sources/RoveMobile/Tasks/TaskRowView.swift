import SwiftUI

/// One task row. Line 1: pin mark + title (+ live plugin tokens when they fit). Line 2: status tag ·
/// branch · marks (`+N/−N`, `↑N/↓N`, PR). Right column: age + engine. Nothing wraps.
struct TaskRowView: View {
    var row: TaskRow
    @Environment(AppModel.self) private var model

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 5) {
                titleLine
                detailLine
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 5) {
                TimelineView(.periodic(from: .distantPast, by: 1)) { ctx in
                    Text(model.store.activityMs(row, now: ctx.date).map { TaskListLogic.age(ms: $0) } ?? "—")
                        .font(Theme.mono(13))
                        .monospacedDigit()
                        .foregroundStyle(Theme.muted)
                }
                if let e = row.engine {
                    Text(e.name.lowercased()).font(Theme.mono(11)).foregroundStyle(Theme.muted).lineLimit(1)
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .accessibilityElement(children: .combine)
    }

    private var title: some View {
        HStack(spacing: 5) {
            if row.pinned {
                Text(TaskRowMarks.pinned).font(Theme.mono(13, .bold)).foregroundStyle(Theme.accent)
                    .accessibilityLabel("Pinned")
            }
            Text(row.displayTitle)
                .font(Theme.face(16, .medium))
                .foregroundStyle(Theme.ink)
                .lineLimit(1)
        }
    }

    /// Tokens expire on the clock, so a row that has any re-evaluates every second; a row without
    /// tokens pays for no timeline.
    @ViewBuilder private var titleLine: some View {
        if row.rowTokens.isEmpty {
            title
        } else {
            TimelineView(.periodic(from: .distantPast, by: 1)) { ctx in
                let live = TaskRowMarks.liveTokens(row.rowTokens, now: ctx.date)
                if live.isEmpty {
                    title
                } else {
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 8) { title; Spacer(minLength: 0); RowTokenTags(tokens: live) }
                        title
                    }
                }
            }
        }
    }

    private var detailLine: some View {
        HStack(spacing: 6) {
            if row.deleting {
                Text("deleting").font(Theme.mono(11, .medium)).foregroundStyle(Theme.muted)
            } else {
                StatusTag(group: row.group)
            }
            if row.kind == "main" {
                Text("main checkout").font(Theme.mono(12)).foregroundStyle(Theme.muted)
            } else if !row.branch.isEmpty {
                Text(row.branch)
                    .font(Theme.mono(12))
                    .foregroundStyle(Theme.muted)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            marks
        }
    }

    /// Fixed-size marks keep their glyphs; the branch is what gives way.
    private var marks: some View {
        let changes = TaskRowMarks.changes(row.changes)
        let drift = TaskRowMarks.aheadBehind(row.changes)
        return HStack(spacing: 6) {
            if !changes.isEmpty { MarkText(segments: changes) }
            if !drift.isEmpty { MarkText(segments: drift) }
            if let pr = row.pr { PRTag(pr: pr, chip: TaskRowMarks.chipKind(row), stale: row.prChipStale) }
            else if let mark = TaskRowMarks.prMark(kind: row.prChip, stale: row.prChipStale) { MarkText(segments: [mark]) }
        }
        .layoutPriority(1)
    }
}
