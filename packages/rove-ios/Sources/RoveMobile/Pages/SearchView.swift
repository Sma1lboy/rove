import SwiftUI

struct SearchHit: Decodable, Hashable {
    var taskId: String
    var title: String
    var tabId: String?
    var role: String
    var at: String
    var snippet: String

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        taskId = try c.decode(String.self, forKey: .taskId)
        title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
        tabId = try c.decodeIfPresent(String.self, forKey: .tabId)
        role = try c.decodeIfPresent(String.self, forKey: .role) ?? "assistant"
        at = try c.decodeIfPresent(String.self, forKey: .at) ?? ""
        snippet = try c.decodeIfPresent(String.self, forKey: .snippet) ?? ""
    }
    enum CodingKeys: String, CodingKey { case taskId, title, tabId, role, at, snippet }
}

/// `sessions.search`'s answer. `skipped` only counts here, so its entries' shape does not matter.
struct SearchReply: Decodable {
    var matches: [SearchHit]
    var skipped: Int
    var truncated: Bool

    private struct Skip: Decodable {}
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        matches = try c.decodeIfPresent([SearchHit].self, forKey: .matches) ?? []
        skipped = try c.decodeIfPresent([Skip].self, forKey: .skipped)?.count ?? 0
        truncated = try c.decodeIfPresent(Bool.self, forKey: .truncated) ?? false
    }
    enum CodingKeys: String, CodingKey { case matches, skipped, truncated }
}

enum SearchLogic {
    static let minChars = 2

    /// `text` cut at each case-insensitive `needle`, in order; `hit` marks the matched pieces.
    static func segments(_ text: String, needle: String) -> [(text: String, hit: Bool)] {
        guard !needle.isEmpty else { return [(text, false)] }
        var out: [(text: String, hit: Bool)] = []
        var from = text.startIndex
        while let found = text.range(of: needle, options: .caseInsensitive, range: from..<text.endIndex) {
            if found.lowerBound > from { out.append((String(text[from..<found.lowerBound]), false)) }
            out.append((String(text[found]), true))
            from = found.upperBound
        }
        if from < text.endIndex { out.append((String(text[from...]), false)) }
        return out
    }
}

/// What was said in any task's conversations, newest session first. A hit opens its task on the tab it
/// came from; the terminal cannot scroll to the line, so the row shows the words around it.
struct SearchView: View {
    private enum Phase {
        case idle, searching
        case done(query: String, reply: SearchReply)
        case failed(String)
    }

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var phase = Phase.idle
    @FocusState private var focused: Bool

    private var trimmed: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        VStack(spacing: 0) {
            ScreenHeader(back: { dismiss() }) {
                Text("search conversations").font(Theme.face(16, .semibold)).foregroundStyle(Theme.ink)
                    .accessibilityAddTraits(.isHeader)
            } trailing: { EmptyView() }
            FieldBox {
                HStack(spacing: 8) {
                    TextField("find something said in any task", text: $query)
                        .focused($focused)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .submitLabel(.search)
                        .accessibilityIdentifier("conversationSearchField")
                    if !query.isEmpty {
                        Button { query = "" } label: { Text(verbatim: "×").font(Theme.mono(16)).foregroundStyle(Theme.muted) }
                            .buttonStyle(.pressable)
                            .accessibilityLabel("Clear search")
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 6)
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) { results }
                    .padding(.bottom, 24)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .background(Theme.paper.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .keyboardDoneButton(active: model.sheets.isEmpty)
        .onAppear { focused = true }
        .task(id: trimmed) { await search(trimmed) }
    }

    @ViewBuilder private var results: some View {
        switch phase {
        case .idle:
            notice(Text("searches what you and the agents wrote, newest first; tool output is left out. a hit opens its task."))
        case .searching:
            HStack(spacing: 8) {
                BrailleSpinner(size: 13)
                Text("searching…").font(Theme.mono(13)).foregroundStyle(Theme.muted)
            }
            .padding(.horizontal, 20).padding(.vertical, 10)
        case .failed(let message):
            ErrorLine(text: message).padding(.horizontal, 20).padding(.vertical, 10)
                .accessibilityIdentifier("searchError")
        case .done(let done, let reply):
            if reply.matches.isEmpty { notice(Text("nothing said matches “\(done)”.")) }
            ForEach(Array(reply.matches.enumerated()), id: \.offset) { _, hit in row(hit, needle: done) }
            if reply.truncated { notice(Text("stopped early to stay fast; add a word to narrow it.")) }
            if reply.skipped > 0 {
                notice(Text("\(reply.skipped) task(s) not searched: another machine's, or an engine rove cannot read."))
            }
        }
    }

    private func notice(_ text: Text) -> some View {
        text.font(Theme.mono(12)).foregroundStyle(Theme.muted)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 20).padding(.vertical, 10)
    }

    private func row(_ hit: SearchHit, needle: String) -> some View {
        Button {
            model.path.append(hit.tabId.map { Route.taskTab(hit.taskId, $0) } ?? .task(hit.taskId))
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(hit.title.isEmpty ? hit.taskId : hit.title)
                        .font(Theme.face(16, .medium)).foregroundStyle(Theme.ink).lineLimit(1)
                    Spacer(minLength: 0)
                    Text(meta(hit)).font(Theme.mono(12)).monospacedDigit().foregroundStyle(Theme.muted).fixedSize()
                }
                Text(snippet(hit.snippet, needle: needle)).font(Theme.mono(12)).foregroundStyle(Theme.muted)
                    .lineLimit(3).multilineTextAlignment(.leading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 12).padding(.vertical, 10)
        }
        .buttonStyle(RowButtonStyle())
        .padding(.horizontal, 8)
        .accessibilityIdentifier("searchHit-\(hit.taskId)")
    }

    private func meta(_ hit: SearchHit) -> String {
        let who = hit.role == "user" ? String(localized: "you") : String(localized: "agent")
        guard let at = TaskListLogic.parseTimestamp(hit.at) else { return who }
        return "\(who) · \(TaskListLogic.age(ms: (Date().timeIntervalSince1970 - at) * 1000))"
    }

    private func snippet(_ text: String, needle: String) -> AttributedString {
        SearchLogic.segments(text, needle: needle).reduce(into: AttributedString()) { out, part in
            var piece = AttributedString(part.text)
            if part.hit {
                piece.foregroundColor = Theme.accent
                piece.backgroundColor = Theme.accentSoft
            }
            out += piece
        }
    }

    /// Runs per query change; a newer query cancels the wait and drops the older answer.
    private func search(_ q: String) async {
        guard q.count >= SearchLogic.minChars else { phase = .idle; return }
        do { try await Task.sleep(for: .milliseconds(300)) } catch { return }
        phase = .searching
        do {
            let reply = try await model.client.request("sessions.search", ["query": q], as: SearchReply.self)
            if !Task.isCancelled { phase = .done(query: q, reply: reply) }
        } catch {
            if !Task.isCancelled { phase = .failed(error.localizedDescription) }
        }
    }
}
