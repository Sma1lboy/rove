import SwiftUI

/// Pure helpers for what the board prints; the views below only lay it out.
enum BoardCardLogic {
    static func trim(_ s: String) -> String { s.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// The first non-empty line of a description, trimmed; nil when there is none.
    static func firstLine(_ detail: String) -> String? {
        detail.split(whereSeparator: \.isNewline).lazy.map { trim(String($0)) }.first { !$0.isEmpty }
    }

    /// `backlog 3`: the name, then the count of the whole column (hidden cards included).
    static func tileLabel(_ key: BoardColumn, in columns: [BoardColumnData]) -> String {
        let count = columns.first { $0.key == key }.map { $0.stories.count + $0.hiddenCount } ?? 0
        return "\(key.title) \(count)"
    }

    /// In progress when it has cards, else backlog.
    static func defaultColumn(_ columns: [BoardColumnData]) -> BoardColumn {
        columns.first { $0.key == .inProgress }?.stories.isEmpty == false ? .inProgress : .backlog
    }

    static func emptyLines(_ key: BoardColumn) -> (title: String, detail: String) {
        switch key {
        case .backlog: ("backlog is empty", "+ files a story")
        case .inProgress: ("nothing in progress", "start a session from a card")
        case .parked: ("nothing parked", "set a story to hold to park it")
        case .done: ("nothing done yet", "set a story to done to close it")
        }
    }

    /// Repo basenames; two projects sharing one are told apart by their parent folder.
    static func projectLabels(_ paths: [String]) -> [String: String] {
        let bases = paths.map { URL(fileURLWithPath: $0).lastPathComponent }
        var counts: [String: Int] = [:]
        for base in bases { counts[base, default: 0] += 1 }
        var labels: [String: String] = [:]
        for (path, base) in zip(paths, bases) {
            let parent = URL(fileURLWithPath: path).deletingLastPathComponent().lastPathComponent
            labels[path] = counts[base, default: 0] > 1 && !parent.isEmpty && parent != "/" ? "\(parent)/\(base)" : base
        }
        return labels
    }
}

/// Phone column switch: four mono tiles, `backlog 3 · in progress 2 · parked 0 · done 5`.
struct BoardColumnTabs: View {
    var columns: [BoardColumnData]
    @Binding var selection: BoardColumn

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            ChoiceTiles(options: BoardColumn.allCases, selection: $selection,
                        label: { BoardCardLogic.tileLabel($0, in: columns) }, fill: false)
        }
        .accessibilityIdentifier("boardColumns")
    }
}

/// One column's cards as a vertical list; capped columns end in `+N more`.
struct BoardColumnList: View {
    var column: BoardColumnData
    var open: (Story) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if column.stories.isEmpty {
                let lines = BoardCardLogic.emptyLines(column.key)
                EmptyState(title: lines.title, detail: lines.detail).padding(.top, 6)
            }
            ForEach(column.stories) { story in
                StoryCard(story: story) { open(story) }
            }
            if column.hiddenCount > 0 {
                Text("+\(column.hiddenCount) more").font(Theme.mono(12)).foregroundStyle(Theme.muted)
                    .padding(.top, 2)
                    .accessibilityIdentifier("boardMore")
            }
        }
    }
}

/// One story: `#id` and title, the first line of its description, and for a linked story the
/// task's status tag with its engine. A link whose task is not in the feed yet reads `linked`.
struct StoryCard: View {
    var story: Story
    var open: () -> Void
    @Environment(AppModel.self) private var model

    var body: some View {
        let task = story.taskId.flatMap { model.store.task(id: $0) }
        Button(action: open) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text("#\(story.id)").font(Theme.mono(12, .medium)).foregroundStyle(Theme.muted)
                    Text(story.title).font(Theme.face(15, .semibold)).foregroundStyle(Theme.ink)
                        .lineLimit(2).multilineTextAlignment(.leading)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if let line = BoardCardLogic.firstLine(story.detail) {
                    Text(line).font(Theme.face(13)).foregroundStyle(Theme.muted).lineLimit(1)
                }
                if story.linked { linkLine(task) }
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .tile()
        }
        .buttonStyle(.pressable)
        .accessibilityIdentifier("storyCard-\(story.id)")
    }

    private func linkLine(_ task: TaskRow?) -> some View {
        HStack(spacing: 8) {
            if let task {
                StatusTag(group: task.group)
                if let engine = task.engine {
                    Text(engine.name.lowercased()).font(Theme.mono(11)).foregroundStyle(Theme.muted)
                }
            } else {
                Text("linked").font(Theme.mono(11)).foregroundStyle(Theme.muted)
            }
        }
    }
}
