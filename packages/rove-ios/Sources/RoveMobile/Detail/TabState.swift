import Foundation
import Observation
import SwiftUI

/// One tab's engine activity as `tab.states` reports it (`debug.inspect` `activity.tabs`).
struct TabActivity: Codable, Hashable {
    var state: String
    var at: Double
}

/// `tab.states` answer. A bridge without the op, or a task with no readings, decodes to an empty map.
struct TabStatesResult: Decodable, Equatable {
    var tabs: [String: TabActivity]

    init(tabs: [String: TabActivity] = [:]) { self.tabs = tabs }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        tabs = try c.decodeIfPresent([String: TabActivity].self, forKey: .tabs) ?? [:]
    }
    enum CodingKeys: String, CodingKey { case tabs }
}

/// The tab-strip vocabulary from docs/TUI.md: a spinner, `?` needs input, `!` error, `◷` rate limited,
/// `†` exited, `●` finished and not yet looked at, `○` quiet.
enum TabGlyph: Equatable {
    case working, needsInput, error, rateLimited, exited, unseenDone, quiet

    var symbol: String {
        switch self {
        case .working: "⠿"
        case .needsInput: "?"
        case .error: "!"
        case .rateLimited: "◷"
        case .exited: "†"
        case .unseenDone: "●"
        case .quiet: "○"
        }
    }

    /// The word a screen reader hears where the TUI relies on the glyph.
    var word: String {
        switch self {
        case .working: "working"
        case .needsInput: "needs input"
        case .error: "error"
        case .rateLimited: "rate limited"
        case .exited: "exited"
        case .unseenDone: "finished, unread"
        case .quiet: "idle"
        }
    }

    var tint: Color {
        switch self {
        case .working, .needsInput, .unseenDone: Theme.accent
        case .error: Theme.error
        case .rateLimited, .exited, .quiet: Theme.muted
        }
    }
}

enum TabStateLogic {
    /// Glyph for one tab. `seenAt` is the completion timestamp the phone last showed; a newer
    /// `turn_complete` is unread again, an equal or older one has been consumed.
    static func glyph(activity: TabActivity?, alive: Bool?, seenAt: Double?) -> TabGlyph {
        if alive == false { return .exited }
        switch activity?.state {
        case "running": return .working
        case "permission_needed", "needs_input": return .needsInput
        case "error": return .error
        case "rate_limited": return .rateLimited
        case "dead": return .exited
        case "turn_complete":
            guard let activity else { return .quiet }
            return (seenAt ?? 0) >= activity.at ? .quiet : .unseenDone
        default: return .quiet
        }
    }
}

/// Phone-local "seen means consumed": the completion `at` last shown per (task, tab).
struct SeenMarks {
    private let defaults: UserDefaults
    private static let storageKey = "tabCompletionSeen"
    /// Oldest marks prune, like the TUI's `completionSeen` cap; at worst one old lamp re-lights.
    private static let limit = 200

    init(defaults: UserDefaults = .standard) { self.defaults = defaults }

    private func marks() -> [String: Double] { (defaults.dictionary(forKey: Self.storageKey) as? [String: Double]) ?? [:] }
    static func markKey(_ taskId: String, _ tabId: String) -> String { "\(taskId)\u{0}\(tabId)" }

    func seenAt(task: String, tab: String) -> Double? { marks()[Self.markKey(task, tab)] }

    func mark(task: String, tab: String, at: Double) {
        var all = marks()
        let k = Self.markKey(task, tab)
        guard (all[k] ?? 0) < at else { return }
        all[k] = at
        if all.count > Self.limit {
            for stale in all.sorted(by: { $0.value < $1.value }).prefix(all.count - Self.limit) { all[stale.key] = nil }
        }
        defaults.set(all, forKey: Self.storageKey)
    }
}

/// Per-tab glyphs for one task detail screen.
@MainActor @Observable
final class TabStateModel {
    private(set) var states: [String: TabActivity] = [:]
    @ObservationIgnored private let seen: SeenMarks
    /// Bumped when a mark is written so views redraw the `●` → `○` settle.
    private(set) var marksVersion = 0

    init(seen: SeenMarks = SeenMarks()) { self.seen = seen }

    func refresh(client: BridgeClient, taskId: String) async {
        // A bridge that predates `tab.states` leaves every tab quiet rather than failing the screen.
        if let r = try? await client.request("tab.states", ["taskId": taskId], as: TabStatesResult.self) { states = r.tabs }
    }

    /// Per-tab activity changes do not always move the task's rolled-up row, so poll while visible.
    /// The tab being looked at consumes its own finished turn as it lands.
    func poll(client: BridgeClient, taskId: String, viewing: @escaping () -> String?) async {
        while !Task.isCancelled {
            await refresh(client: client, taskId: taskId)
            if let tab = viewing() { markSeen(taskId: taskId, tabId: tab) }
            try? await Task.sleep(for: .seconds(4))
        }
    }

    func glyph(taskId: String, tab: TabRow) -> TabGlyph {
        _ = marksVersion
        return TabStateLogic.glyph(activity: states[tab.id], alive: tab.alive, seenAt: seen.seenAt(task: taskId, tab: tab.id))
    }

    /// Opening the tab consumes its finished turn.
    func markSeen(taskId: String, tabId: String) {
        guard let a = states[tabId], a.state == "turn_complete" else { return }
        seen.mark(task: taskId, tab: tabId, at: a.at)
        marksVersion += 1
    }
}

/// The glyph in front of a tab's name; the working one animates.
struct TabGlyphView: View {
    var glyph: TabGlyph

    var body: some View {
        Group {
            if glyph == .working {
                BrailleSpinner(size: 12)
            } else {
                Text(glyph.symbol).font(Theme.mono(12, .semibold)).foregroundStyle(glyph.tint)
            }
        }
        .frame(minWidth: 12)
        .accessibilityHidden(true)
    }
}
