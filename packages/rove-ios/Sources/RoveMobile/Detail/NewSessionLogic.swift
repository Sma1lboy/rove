import Foundation

/// Where a new session runs: a tab in this worktree, or a child task in a fresh worktree (`ctrl+e` `tab`).
enum SessionDestination: String, CaseIterable, Hashable {
    case tab, fork
}

/// What the new session starts from: a blank conversation, or this one's transcript (`ctrl+e` `ctrl+f`).
enum SessionContext: String, CaseIterable, Hashable {
    case fresh, continued
}

/// `tab.handoff`'s answer: the brief for a continuing session, or why there is nothing to continue.
struct HandoffAnswer: Codable, Equatable {
    var kind: String
    var prompt: String?
    var engine: String?
}

/// `tab.forkTask`'s answer: one id, or one per attempt.
struct ForkTaskResult: Codable, Equatable {
    var taskIds: [String]
}

enum NewSessionLogic {
    /// The TUI's attempts chip stops at 5 where the CLI allows 10.
    static let maxAttempts = 5

    enum Request: Equatable {
        case tab(prompt: String, engine: String?)
        case fork(repo: String, baseBranch: String, prompt: String, engine: String?, count: Int)
    }

    /// The first message: the handoff brief, then the user's own words under it.
    static func prompt(message: String, handoff: String?) -> String? {
        let words = message.trimmingCharacters(in: .whitespacesAndNewlines)
        switch (handoff, words.isEmpty) {
        case (nil, true): return nil
        case (nil, false): return words
        case (let brief?, true): return brief
        case (let brief?, false): return "\(brief)\n\n\(words)"
        }
    }

    /// Why a conversation cannot be continued, in the TUI's terms; nil when it can.
    static func refusal(_ answer: HandoffAnswer) -> String? {
        switch answer.kind {
        case "handoff": return answer.prompt == nil ? String(localized: "nothing to hand off") : nil
        case "no-session": return String(localized: "this tab has no conversation yet")
        case "no-transcript":
            let engine = answer.engine ?? String(localized: "this engine")
            return String(localized: "\(engine) keeps no transcript rove can read, so there is nothing to hand off")
        default: return String(localized: "this conversation cannot be continued")
        }
    }

    /// The op to run, or nil while the form is not ready. Continuing needs the brief (the words are
    /// optional); a fresh session needs the words. A fork also needs the branch it branches from.
    static func request(destination: SessionDestination, context: SessionContext, engine: String, message: String,
                        handoff: HandoffAnswer?, attempts: Int, repo: String, branch: String) -> Request? {
        let brief: String?
        switch context {
        case .fresh: brief = nil
        case .continued:
            guard let handoff, refusal(handoff) == nil else { return nil }
            brief = handoff.prompt
        }
        guard let text = prompt(message: message, handoff: brief) else { return nil }
        let engine = engine.isEmpty ? nil : engine
        switch destination {
        case .tab: return .tab(prompt: text, engine: engine)
        case .fork:
            guard !repo.isEmpty, !branch.isEmpty else { return nil }
            return .fork(repo: repo, baseBranch: branch, prompt: text, engine: engine, count: min(max(attempts, 1), maxAttempts))
        }
    }
}
