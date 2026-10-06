import SwiftUI
import UIKit

enum DiffMetrics {
    static var charWidth: CGFloat {
        let font = UIFont.monospacedSystemFont(ofSize: Theme.scaled(12), weight: .regular)
        return ("0" as NSString).size(withAttributes: [.font: font]).width
    }
    static let gutter: CGFloat = 46
    /// Width that holds the longest line, so every row's wash reaches the same edge.
    static func contentWidth(_ longest: Int) -> CGFloat { gutter + 10 + CGFloat(longest + 2) * charWidth }
}

/// Selection over a diff's rows: tap one line, tap another to extend to a range, tap again to restart.
struct DiffSelection: Equatable {
    var anchor: Int?
    var cursor: Int?

    mutating func tap(_ i: Int) {
        switch (anchor, cursor) {
        case (nil, _), (_, nil): anchor = i; cursor = i
        case let (a?, c?) where a == c && a == i: anchor = nil; cursor = nil
        case let (a?, c?) where a == c: cursor = i
        default: anchor = i; cursor = i
        }
    }

    var isEmpty: Bool { cursor == nil }
    func contains(_ i: Int) -> Bool {
        guard let a = anchor, let c = cursor else { return false }
        return (min(a, c)...max(a, c)).contains(i)
    }
}

/// A unified diff (or file text) as numbered mono rows. Selectable rows take part in review notes.
struct DiffLinesView: View {
    let lines: [DiffLine]
    var file: String
    var notes: [ReviewNote] = []
    /// False for a plain file preview or a combined diff: rows then cannot be selected.
    @Binding var selection: DiffSelection
    var selectable = true

    var body: some View {
        let longest = lines.map { $0.text.count }.max() ?? 0
        let width = DiffMetrics.contentWidth(longest)
        GeometryReader { geo in
            ScrollView([.horizontal, .vertical]) {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(lines.enumerated()), id: \.element.id) { idx, line in
                        row(line, index: idx, width: max(width, geo.size.width))
                        ForEach(notes.filter { $0.line == line.number && line.selectable && lastRow(of: $0, at: idx) }) { n in
                            noteCard(n)
                        }
                    }
                }
                .padding(.bottom, 80)
                .frame(minWidth: geo.size.width, minHeight: geo.size.height, alignment: .topLeading)
            }
            .scrollIndicators(.visible)
        }
        .background(Theme.surface)
    }

    /// A note's card hangs under the first row that carries its end line.
    private func lastRow(of note: ReviewNote, at idx: Int) -> Bool {
        lines.firstIndex { $0.number == note.line && $0.selectable } == idx
    }

    private func row(_ line: DiffLine, index: Int, width: CGFloat) -> some View {
        let picked = selection.contains(index)
        let noted = line.number.map { n in notes.contains { DiffParser.covers($0, file: file, number: n) } } ?? false
        return HStack(spacing: 0) {
            Text(line.number.map(String.init) ?? "")
                .font(Theme.mono(11)).foregroundStyle(Theme.muted)
                .frame(width: DiffMetrics.gutter, alignment: .trailing)
                .padding(.trailing, 6)
            Text(line.text.isEmpty ? " " : line.text)
                .font(Theme.mono(12))
                .foregroundStyle(line.kind.color)
                .fixedSize(horizontal: true, vertical: false)
            Spacer(minLength: 0)
        }
        .frame(width: width, alignment: .leading)
        .padding(.vertical, line.kind == .hunk ? 4 : 1)
        .background(picked ? Theme.accentSoft : line.kind.wash)
        .overlay(alignment: .leading) {
            if noted || picked { Rectangle().fill(Theme.accent).frame(width: 3) }
        }
        .contentShape(Rectangle())
        .onTapGesture { if selectable, line.selectable { withAnimation(Theme.spring) { selection.tap(index) } } }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(line.text)
        .accessibilityIdentifier("diffLine-\(index)")
    }

    private func noteCard(_ n: ReviewNote) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Text(n.isSent ? String(localized: "sent") : String(localized: "note")).font(Theme.mono(11, .medium)).foregroundStyle(n.isSent ? Theme.muted : Theme.accent)
            Text(n.body).font(Theme.face(14)).foregroundStyle(Theme.ink).fixedSize(horizontal: false, vertical: true)
        }
        .padding(10)
        .frame(maxWidth: 320, alignment: .leading)
        .tile()
        .padding(.leading, DiffMetrics.gutter + 10).padding(.vertical, 4)
    }
}
