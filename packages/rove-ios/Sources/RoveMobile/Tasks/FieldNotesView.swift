import SwiftUI

/// A repo's field notes (`notes.list`, the daemon's own newest-first order): one mono tile per note,
/// each retired with an explicit `delete` and a red confirmation (`notes.delete`).
struct FieldNotesView: View {
    let repo: String
    @Environment(AppModel.self) private var model
    @State private var notes: [FieldNote] = []
    @State private var loading = true
    @State private var error: String?
    @State private var deleting: FieldNote?

    private var projectName: String { URL(fileURLWithPath: repo).lastPathComponent }

    var body: some View {
        SheetScaffold(title: String(localized: "field notes"), kicker: projectName) {
            if loading {
                BrailleSpinner(size: 13)
            } else if let error {
                ErrorLine(text: error)
            } else if notes.isEmpty {
                EmptyState(title: String(localized: "no field notes"), detail: String(localized: "workers leave notes here as they learn the repo"))
                    .accessibilityIdentifier("notesEmpty")
            } else {
                Hint(text: String(localized: "The newest notes are handed to every fresh session on this repo, so retire any that stopped being true."))
                VStack(spacing: 8) { ForEach(notes) { noteTile($0) } }
            }
        }
        .task { await load() }
        .sheet(item: $deleting) { note in
            NoteDeleteSheet(repo: repo, note: note) { await load() }
        }
    }

    private func noteTile(_ note: FieldNote) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(note.text).font(Theme.mono(13)).foregroundStyle(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
            HStack {
                Text(["#\(note.id)", note.at].compactMap { $0 }.joined(separator: " · "))
                    .font(Theme.mono(11)).foregroundStyle(Theme.muted).lineLimit(1)
                Spacer()
                Button { deleting = note } label: {
                    Text("delete").font(Theme.mono(12, .medium)).foregroundStyle(Theme.error)
                        .frame(minWidth: 44, minHeight: 36, alignment: .trailing)
                }
                .buttonStyle(.pressable)
                .accessibilityIdentifier("deleteNote-\(note.id)")
            }
        }
        .padding(12)
        .tile()
    }

    private func load() async {
        defer { loading = false }
        do {
            notes = try await model.client.request("notes.list", ["repo": repo], as: NotesResult.self).notes
            error = nil
        } catch { self.error = error.localizedDescription }
    }
}

/// `notes.delete` behind its own red confirmation; the note is gone for every future session.
private struct NoteDeleteSheet: View {
    let repo: String
    let note: FieldNote
    var done: () async -> Void
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        SheetScaffold(title: String(localized: "delete this note?"), kicker: String(localized: "field note #\(note.id)"), error: error,
                      primary: PrimaryBar(label: String(localized: "delete note"), destructive: true, busy: busy,
                                          identifier: "confirmDeleteNoteButton") { Task { await run() } }) {
            Text(note.text).font(Theme.mono(13)).foregroundStyle(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
                .tile()
            Hint(text: String(localized: "Fresh sessions on this repo stop receiving it. This cannot be undone."))
        }
        .presentationDetents([.medium])
    }

    private func run() async {
        busy = true
        defer { busy = false }
        do {
            // `deleted: false` means the id named nothing (already evicted): the note is gone either way.
            _ = try await model.client.request("notes.delete", ["repo": repo, "id": note.id], as: NoteDeleteResult.self)
            await done()
            dismiss()
        } catch { self.error = error.localizedDescription }
    }
}
