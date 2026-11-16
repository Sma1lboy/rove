import SwiftUI

struct PRCheck: Decodable, Hashable {
    /// `fail` / `pending` / `pass` / `skipped`.
    var state: String
    var name: String
    var durationMs: Double?
    /// Epoch ms.
    var startedAt: Double?
    var completedAt: Double?
    var url: String?
    /// The Actions run whose log can be read; nil for another provider's check.
    var runId: String?
}

/// `pr.checks`: `none` (no PR), `unavailable` (gh failed, `detail`), or `ok` with the checks.
struct ChecksReply: Decodable {
    var outcome: String
    var detail: String?
    var total: Int?
    var checks: [PRCheck]?
    var mergeable: String?
    var mergeState: String?
    var review: String?
    var draft: Bool?
}

struct CheckLogReply: Decodable {
    var outcome: String
    var tail: String?
    var detail: String?
}

/// Words for the checks section (web `checks-data.ts`).
enum ChecksLogic {
    /// Only an open PR on this Mac's own worktree has checks worth reading.
    static func applies(_ row: TaskRow?) -> Bool {
        guard let row, row.machine == nil, let pr = row.pr, pr.number != nil else { return false }
        return pr.lifecycle == "open" || pr.lifecycle == "ready_to_merge"
    }

    /// `42s`, `3m12s`, `1h05m`.
    static func duration(ms: Double) -> String {
        let s = max(0, Int((ms / 1000).rounded()))
        if s < 60 { return "\(s)s" }
        let m = s / 60
        if m < 60 { return String(format: "%dm%02ds", m, s % 60) }
        return String(format: "%dh%02dm", m / 60, m % 60)
    }

    /// How long a finished check took, or how long a running one has run.
    static func timing(_ c: PRCheck, nowMs: Double) -> String? {
        if c.state == "pending" { return c.startedAt.map { String(localized: "running \(duration(ms: nowMs - $0))") } }
        return c.durationMs.map { duration(ms: $0) }
    }

    /// What stands between the PR and a merge, most blocking first; `error` = needs a person.
    static func mergeParts(_ r: ChecksReply) -> [(text: String, tone: MarkTone)] {
        var parts: [(String, MarkTone)] = []
        let state = (r.mergeState ?? "").uppercased()
        if r.draft == true { parts.append((String(localized: "draft"), .accent)) }
        if (r.mergeable ?? "").uppercased() == "CONFLICTING" || state == "DIRTY" { parts.append((String(localized: "conflicts"), .error)) }
        else if state == "BEHIND" { parts.append((String(localized: "behind base"), .accent)) }
        else if state == "UNSTABLE" { parts.append((String(localized: "checks not passing"), .accent)) }
        else if state == "BLOCKED" { parts.append((String(localized: "blocked"), .accent)) }
        else if state == "CLEAN", r.draft != true { parts.append((String(localized: "mergeable"), .success)) }
        switch (r.review ?? "").uppercased() {
        case "APPROVED": parts.append((String(localized: "approved"), .success))
        case "CHANGES_REQUESTED": parts.append((String(localized: "changes requested"), .error))
        case "REVIEW_REQUIRED": parts.append((String(localized: "review required"), .accent))
        default: break
        }
        return parts
    }

    static func glyph(_ state: String) -> MarkSegment {
        switch state {
        case "pass": MarkSegment(text: "✓", tone: .success)
        case "fail": MarkSegment(text: "✗", tone: .error)
        case "pending": MarkSegment(text: "●", tone: .accent)
        default: MarkSegment(text: "–", tone: .muted)
        }
    }
}

/// Files › changes: the PR's CI checks, a merge-readiness line, and a failed Actions job's log tail
/// in place. Read on open and on the screen's refresh, never on a timer (`pr.checks` runs `gh`).
struct ChecksSection: View {
    let taskId: String
    var refresh: Int
    @Environment(AppModel.self) private var model
    @State private var reply: ChecksReply?
    @State private var open: Bool?
    @State private var logs: [String: String] = [:]

    var body: some View {
        if ChecksLogic.applies(model.store.task(id: taskId)) {
            VStack(alignment: .leading, spacing: 6) { content }
                .task(id: refresh) { await load(fresh: refresh > 0) }
        }
    }

    @ViewBuilder private var content: some View {
        if let reply, reply.outcome == "ok", let checks = reply.checks {
            let counts = Dictionary(grouping: checks, by: \.state).mapValues(\.count)
            let expanded = open ?? ((counts["fail"] ?? 0) + (counts["pending"] ?? 0) > 0)
            Button { withAnimation(Theme.spring) { open = !expanded } } label: {
                // Counts, then what stands before a merge on its own line: one line truncates both at 390.
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Image(systemName: expanded ? "chevron.down" : "chevron.right").font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.muted)
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 8) {
                            Text(String(localized: "\((counts["pass"] ?? 0) + (counts["skipped"] ?? 0))/\(reply.total ?? checks.count) passed"))
                                .foregroundStyle(Theme.ink)
                            if let n = counts["fail"] { Text(String(localized: "\(n) failed")).foregroundStyle(Theme.error) }
                            if let n = counts["pending"] { Text(String(localized: "\(n) running")).foregroundStyle(Theme.accent) }
                        }
                        let merge = ChecksLogic.mergeParts(reply)
                        if !merge.isEmpty {
                            HStack(spacing: 8) { ForEach(Array(merge.enumerated()), id: \.offset) { _, p in Text(p.text).foregroundStyle(p.tone.color) } }
                        }
                    }
                    Spacer(minLength: 0)
                }
                .font(Theme.mono(12)).lineLimit(1).frame(minHeight: 32)
            }
            .buttonStyle(.plain).disabled(checks.isEmpty)
            .accessibilityIdentifier("checksToggle")
            if expanded {
                VStack(alignment: .leading, spacing: 0) { ForEach(checks, id: \.self) { row($0) } }.tile()
                if let total = reply.total, total > checks.count {
                    Text(String(localized: "\(total - checks.count) more not shown")).font(Theme.mono(11)).foregroundStyle(Theme.muted)
                }
            }
        } else {
            Text(reply.map { $0.outcome == "none" ? String(localized: "no checks") : String(localized: "couldn't read the PR: \($0.detail ?? "")") } ?? String(localized: "loading checks"))
                .font(Theme.mono(12)).foregroundStyle(Theme.muted)
        }
    }

    private func row(_ c: PRCheck) -> some View {
        let key = "\(c.runId ?? ""):\(c.name)"
        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                MarkText(segments: [ChecksLogic.glyph(c.state)], size: 12)
                Text(c.name).font(Theme.mono(12)).foregroundStyle(Theme.ink).lineLimit(1).truncationMode(.middle)
                Spacer(minLength: 4)
                if let t = ChecksLogic.timing(c, nowMs: Date().timeIntervalSince1970 * 1000) {
                    Text(t).font(Theme.mono(11)).monospacedDigit().foregroundStyle(Theme.muted)
                }
                if c.state == "fail", c.runId != nil {
                    Button { Task { await toggleLog(c, key: key) } } label: {
                        Text(logs[key] == nil ? String(localized: "log") : String(localized: "hide"))
                            .font(Theme.mono(12)).foregroundStyle(Theme.accent).frame(minHeight: 32)
                    }
                    .buttonStyle(.pressable).accessibilityIdentifier("checkLog-\(c.name)")
                }
            }
            if let log = logs[key] {
                ScrollView(.horizontal) { Text(log).font(Theme.mono(10)).foregroundStyle(Theme.ink).textSelection(.enabled) }
                    .padding(8).background(Theme.inset, in: RoundedRectangle(cornerRadius: Theme.smallRadius, style: .continuous))
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 6)
    }

    private func load(fresh: Bool) async {
        var args: [String: Any] = ["taskId": taskId]
        if fresh { args["fresh"] = true }
        do { reply = try await model.client.request("pr.checks", args, as: ChecksReply.self) }
        catch { reply = ChecksReply(outcome: "unavailable", detail: error.localizedDescription) }
    }

    private func toggleLog(_ c: PRCheck, key: String) async {
        if logs[key] != nil { logs[key] = nil; return }
        logs[key] = "…"
        let r = try? await model.client.request("pr.checkLog", ["taskId": taskId, "runId": c.runId ?? "", "job": c.name], as: CheckLogReply.self)
        guard logs[key] != nil else { return }
        switch r?.outcome {
        case "ok": logs[key] = r?.tail ?? ""
        case "none": logs[key] = String(localized: "no log excerpt for this job")
        default: logs[key] = String(localized: "couldn't read the log: \(r?.detail ?? "")")
        }
    }
}
