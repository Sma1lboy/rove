import SwiftUI

/// A task's engine history (`output.read`): the engine's own transcript when it has one,
/// otherwise a labeled terminal tail. Presented from the task detail menu.
struct TaskHistorySheet: View {
    let taskId: String
    @Environment(AppModel.self) private var model
    @State private var state: SettingsLoad<OutputEnvelope> = .loading
    @State private var messages: [OutputMessage] = []
    @State private var cursor: String?
    @State private var total: Int?
    @State private var limited = false
    @State private var loadingMore = false
    @State private var moreError: String?
    @State private var nothingNewer = false

    private static let pageSize = 30

    var body: some View {
        SheetScaffold(title: "engine history", kicker: "task") {
            switch state {
            case .loading:
                BrailleSpinner(size: 14)
            case .failed(let message):
                ErrorLine(text: message)
                refreshButton
            case .loaded(let envelope):
                header(envelope)
                if envelope.source == "history", envelope.history != nil {
                    transcript(envelope)
                } else {
                    terminalTail(envelope)
                }
                ForEach(envelope.warnings, id: \.self) { warning in
                    Text(warning).font(Theme.mono(12)).foregroundStyle(Theme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                refreshButton
            }
        }
        .presentationDetents([.medium, .large])
        .task { await load() }
    }

    private var refreshButton: some View {
        Button { Task { await load() } } label: { TileLabel(text: "refresh") }
            .buttonStyle(.pressable)
            .accessibilityIdentifier("historyRefresh")
    }

    // MARK: Pieces

    private func header(_ envelope: OutputEnvelope) -> some View {
        HStack(spacing: 8) {
            if envelope.running { SettingsTag(text: "working", tint: Theme.accent, bold: true) }
            if let vendor = envelope.vendor { SettingsTag(text: vendor) }
            Spacer()
        }
    }

    @ViewBuilder
    private func transcript(_ envelope: OutputEnvelope) -> some View {
        if messages.isEmpty {
            EmptyState(title: "no messages yet", detail: "the engine has not written a transcript for this task")
        } else {
            VStack(alignment: .leading, spacing: 18) {
                ForEach(messages) { message in
                    VStack(alignment: .leading, spacing: 8) {
                        Theme.kicker(message.role == "user" ? "you" : "agent")
                        ForEach(Array(message.blocks.enumerated()), id: \.offset) { _, block in
                            HistoryBlock(block: block)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .accessibilityIdentifier("historyTranscript")
        }
        Text(counts()).font(Theme.mono(11)).foregroundStyle(Theme.muted)
        if let moreError { ErrorLine(text: moreError) }
        if cursor != nil {
            Button { Task { await loadNewer() } } label: {
                HStack(spacing: 8) {
                    TileLabel(text: "load newer")
                    if loadingMore { BrailleSpinner(size: 13) }
                }
            }
            .buttonStyle(.pressable)
            .disabled(loadingMore)
            .accessibilityIdentifier("historyLoadNewer")
        }
        if nothingNewer { Text("nothing newer yet").font(Theme.mono(11)).foregroundStyle(Theme.muted) }
    }

    private func counts() -> String {
        var parts = [total.map { "\(messages.count) of \($0) messages" } ?? "\(messages.count) messages"]
        if limited { parts.append("limited") }
        return parts.joined(separator: " · ")
    }

    @ViewBuilder
    private func terminalTail(_ envelope: OutputEnvelope) -> some View {
        let tail = envelope.terminal
        FormSection(label: "no structured history — terminal tail", trailing: flags(tail)) {
            if let reason = envelope.fallbackReason, !reason.isEmpty {
                Text(reason).font(Theme.mono(12)).foregroundStyle(Theme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let tail, !tail.tail.isEmpty {
                Text(tail.tail).font(Theme.mono(12)).foregroundStyle(Theme.muted)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
                    .tile()
                    .accessibilityIdentifier("historyTerminalTail")
            } else {
                EmptyState(title: "nothing to show", detail: "the terminal has no output yet")
            }
        }
    }

    private func flags(_ tail: OutputTerminal?) -> String? {
        guard let tail else { return nil }
        let parts = [tail.live ? "live" : nil, tail.truncated ? "truncated" : nil].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    // MARK: Loading

    private func load() async {
        do {
            let envelope = try await model.client.request(
                "output.read", ["taskId": taskId, "limit": Self.pageSize], as: OutputEnvelope.self)
            messages = Self.numbered(envelope.history?.messages ?? [], from: 0)
            cursor = envelope.cursor
            total = envelope.history?.totalMessages
            limited = envelope.history?.limited ?? false
            moreError = nil
            nothingNewer = false
            state = .loaded(envelope)
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    private func loadNewer() async {
        guard let cursor, !loadingMore else { return }
        loadingMore = true
        moreError = nil
        nothingNewer = false
        defer { loadingMore = false }
        do {
            let envelope = try await model.client.request(
                "output.read", ["taskId": taskId, "limit": Self.pageSize, "cursor": cursor], as: OutputEnvelope.self)
            let more = envelope.history?.messages ?? []
            messages += Self.numbered(more, from: messages.count)
            nothingNewer = more.isEmpty
            self.cursor = envelope.cursor ?? cursor
            total = envelope.history?.totalMessages ?? total
            limited = envelope.history?.limited ?? limited
            if envelope.history != nil { state = .loaded(envelope) }
        } catch {
            moreError = error.localizedDescription
        }
    }

    /// The wire has no message id; ids are positions across every page loaded so far.
    private static func numbered(_ page: [OutputMessage], from start: Int) -> [OutputMessage] {
        page.enumerated().map {
            OutputMessage(role: $1.role, blocks: $1.blocks, timestamp: $1.timestamp, id: start + $0)
        }
    }
}

/// One block of a message: prose, a tool call, or a tool result that expands on tap.
private struct HistoryBlock: View {
    var block: OutputBlock
    @State private var expanded = false

    var body: some View {
        switch block.type {
        case "text":
            Text(block.text ?? "").font(Theme.face(15)).foregroundStyle(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
        case "tool_call":
            VStack(alignment: .leading, spacing: 3) {
                Text(block.name ?? "tool").font(Theme.mono(12, .bold)).foregroundStyle(Theme.ink)
                if let input = block.input, !input.isEmpty {
                    Text(input).font(Theme.mono(12)).foregroundStyle(Theme.ink).lineLimit(4)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(10)
            .tile(Theme.inset)
        case "tool_result":
            let text = block.output ?? block.text ?? ""
            Button { withAnimation(Theme.spring) { expanded.toggle() } } label: {
                Text(text.isEmpty ? "(empty result)" : text).font(Theme.mono(12)).foregroundStyle(Theme.muted)
                    .lineLimit(expanded ? nil : 6)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(10)
                    .tile()
            }
            .buttonStyle(.pressable)
            .accessibilityValue(expanded ? "expanded" : "collapsed")
        default:
            VStack(alignment: .leading, spacing: 3) {
                Text(block.type).font(Theme.mono(11, .medium)).foregroundStyle(Theme.muted)
                if let text = block.text ?? block.output, !text.isEmpty {
                    Text(text).font(Theme.mono(12)).foregroundStyle(Theme.muted).lineLimit(6)
                }
            }
        }
    }
}
