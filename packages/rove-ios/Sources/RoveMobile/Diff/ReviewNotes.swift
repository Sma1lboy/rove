import SwiftUI
import Observation

/// One task's review notes (F5). The bridge keeps them where the TUI does; this is the phone's view.
/// An attached TUI hydrates that store once, so it shows notes written here only after a restart.
@MainActor @Observable
final class ReviewStore {
    let taskId: String
    private(set) var notes: [ReviewNote] = []
    private(set) var busy = false
    var error: String?
    @ObservationIgnored private let client: BridgeClient

    init(client: BridgeClient, taskId: String) { self.client = client; self.taskId = taskId }

    var unsent: [ReviewNote] { notes.filter { !$0.isSent } }
    func notes(in file: String) -> [ReviewNote] { notes.filter { $0.filePath == file } }

    func load() async {
        do {
            notes = try await client.request("review.list", ["taskId": taskId], as: ReviewListResult.self).notes
            error = nil
        } catch { self.error = error.localizedDescription }
    }

    func add(file: String, line: Int, startLine: Int?, body: String) async -> Bool {
        var args: [String: Any] = ["taskId": taskId, "filePath": file, "line": line, "body": body]
        if let startLine { args["startLine"] = startLine }
        do {
            let r = try await client.request("review.add", args, as: ReviewAddResult.self)
            notes.append(r.note)
            error = nil
            return true
        } catch { self.error = error.localizedDescription; return false }
    }

    func remove(_ note: ReviewNote) async {
        do {
            _ = try await client.request("review.remove", ["taskId": taskId, "id": note.id], as: ReviewRemoveResult.self)
            notes.removeAll { $0.id == note.id }
            error = nil
        } catch { self.error = error.localizedDescription }
    }

    /// Sends every unsent note as one prompt. Returns the line to show; notes stay unsent unless the
    /// bridge confirmed delivery.
    func send() async -> String {
        busy = true
        defer { busy = false }
        do {
            let r = try await client.request("review.send", ["taskId": taskId], as: ReviewSendResult.self)
            await load()
            if r.delivered {
                if r.sent == 0 { return String(localized: "nothing to send") }
                return r.sent == 1 ? String(localized: "sent \(r.sent) note to the engine") : String(localized: "sent \(r.sent) notes to the engine")
            }
            if let reason = r.reason { return String(localized: "not delivered — notes kept: \(reason)") }
            return String(localized: "not delivered — notes kept")
        } catch {
            return String(localized: "not delivered — notes kept: \(error.localizedDescription)")
        }
    }
}

/// Write one note for the selected line or range.
struct NoteComposerSheet: View {
    let file: String
    let lines: [DiffLine]
    let range: (line: Int, startLine: Int?)
    let review: ReviewStore
    var onSaved: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var body_ = ""
    @State private var saving = false

    private var label: String {
        range.startLine.map { String(localized: "lines \($0)–\(range.line)") } ?? String(localized: "line \(range.line)")
    }

    var body: some View {
        SheetScaffold(
            title: String(localized: "note"), kicker: "\((file as NSString).lastPathComponent) · \(label)", error: review.error,
            primary: PrimaryBar(label: String(localized: "drop note"), enabled: !body_.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                                busy: saving, identifier: "dropNote") { save() }
        ) {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(lines.prefix(8)) { l in
                    Text(l.text.isEmpty ? " " : l.text)
                        .font(Theme.mono(12)).foregroundStyle(l.kind.color).lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 10).padding(.vertical, 2)
                        .background(l.kind.wash)
                }
                if lines.count > 8 {
                    Text("+ \(lines.count - 8) more lines").font(Theme.mono(11)).foregroundStyle(Theme.muted)
                        .padding(.horizontal, 10).padding(.vertical, 4)
                }
            }
            .tile(Theme.surface)
            FormSection(label: String(localized: "your note")) {
                PromptEditor(text: $body_, placeholder: String(localized: "what should the engine change here?"), minHeight: 110)
            }
            Hint(text: String(localized: "notes stay on this phone's list until you send them — all unsent notes go to the engine as one message."))
        }
    }

    private func save() {
        saving = true
        Task {
            let ok = await review.add(file: file, line: range.line, startLine: range.startLine,
                                      body: body_.trimmingCharacters(in: .whitespacesAndNewlines))
            saving = false
            if ok { onSaved(); dismiss() }
        }
    }
}

/// Every note for the task: drop one (confirmed), send all unsent.
struct NotesSheet: View {
    let review: ReviewStore
    @Environment(\.dismiss) private var dismiss
    @State private var dropping: ReviewNote?
    @State private var confirmSend = false
    @State private var result: String?

    var body: some View {
        SheetScaffold(
            title: String(localized: "review notes"), kicker: String(localized: "\(review.unsent.count) unsent · \(review.notes.count) total"), error: review.error,
            primary: PrimaryBar(label: String(localized: "send \(review.unsent.count) to engine"), enabled: !review.unsent.isEmpty,
                                busy: review.busy, identifier: "sendNotes") { confirmSend = true }
        ) {
            if review.notes.isEmpty {
                EmptyState(title: String(localized: "no notes yet"), detail: String(localized: "tap a diff line, then note, to leave one for the engine"))
            }
            ForEach(review.notes.sorted { $0.createdAt < $1.createdAt }) { n in
                noteRow(n)
            }
            if let result { Text(result).font(Theme.mono(12)).foregroundStyle(Theme.muted) }
        }
        .confirmationDialog("Drop this note?", isPresented: Binding(get: { dropping != nil }, set: { if !$0 { dropping = nil } }),
                            titleVisibility: .visible) {
            Button("Drop note", role: .destructive) { if let n = dropping { Task { await review.remove(n) } } }
        } message: { Text(dropping?.body ?? "") }
        .confirmationDialog("Send unsent notes?", isPresented: $confirmSend, titleVisibility: .visible) {
            Button("Send \(review.unsent.count)") { Task { result = await review.send() } }
        } message: { Text("They go to the task's engine as one message.") }
    }

    private func noteRow(_ n: ReviewNote) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(verbatim: "\(n.filePath):\(n.lineLabel)").font(Theme.mono(12, .medium)).foregroundStyle(Theme.ink)
                    .lineLimit(1).truncationMode(.head)
                Spacer(minLength: 8)
                Text(n.isSent ? String(localized: "sent") : String(localized: "unsent")).font(Theme.mono(11, .medium))
                    .foregroundStyle(n.isSent ? Theme.muted : Theme.accent)
                Button { dropping = n } label: {
                    Text("drop").font(Theme.mono(12)).foregroundStyle(Theme.muted).frame(minWidth: 40, minHeight: 32)
                }
                .buttonStyle(.pressable)
                .accessibilityIdentifier("dropNote-\(n.id)")
            }
            Text(n.body).font(Theme.face(15)).foregroundStyle(Theme.ink).fixedSize(horizontal: false, vertical: true)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .tile()
    }
}
