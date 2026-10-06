import SwiftUI

/// One adoptable worktree: `[x] branch` over the path tail.
private struct AdoptRow: View {
    var worktree: AdoptableWorktree
    @Binding var on: Bool

    var body: some View {
        Button { withAnimation(Theme.spring) { on.toggle() } } label: {
            HStack(spacing: 10) {
                Text(on ? "[x]" : "[ ]").font(Theme.mono(14, .bold)).foregroundStyle(on ? Theme.accent : Theme.muted)
                VStack(alignment: .leading, spacing: 2) {
                    Text(worktree.branch ?? "detached")
                        .font(Theme.mono(14, on ? .semibold : .medium))
                        .foregroundStyle(on ? Theme.accent : Theme.ink)
                    Text(AdoptSelection.pathTail(worktree.path))
                        .font(Theme.mono(11)).foregroundStyle(Theme.muted).lineLimit(1).truncationMode(.head)
                }
                Spacer()
            }
            .padding(.horizontal, 14).padding(.vertical, 10)
            .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
            .selectableTile(on)
        }
        .buttonStyle(.pressable)
        .accessibilityValue(on ? "on" : "off")
    }
}

/// Mode `adopt`: pick a repo, tick existing worktrees, optionally an engine.
struct NewTaskAdoptForm: View {
    @Bindable var draft: NewTaskDraft

    var body: some View {
        RepoTiles(repos: draft.repos, loading: !draft.loadedLists, selection: $draft.spawn.repo)
        FormSection(label: "worktrees", trailing: draft.adoptable.isEmpty ? nil : "\(draft.adopt.count)/\(draft.adoptable.count)") {
            if !draft.adoptLoaded {
                BrailleSpinner(size: 13)
            } else if draft.adoptable.isEmpty {
                EmptyState(title: "nothing to adopt", detail: "every worktree of this repo is already a task.")
            } else {
                VStack(spacing: 6) {
                    ForEach(draft.adoptable) { wt in
                        AdoptRow(worktree: wt, on: Binding(get: { draft.adopt.contains(wt.path) }, set: { draft.adopt.set(wt.path, on: $0) }))
                    }
                }
                Button {
                    withAnimation(Theme.spring) {
                        if draft.adopt.count == draft.adoptable.count { draft.adopt.clear() } else { draft.adopt.selectAll(draft.adoptable.map(\.path)) }
                    }
                } label: {
                    Text(draft.adopt.count == draft.adoptable.count ? "clear" : "select all")
                        .font(Theme.mono(13, .medium)).foregroundStyle(Theme.muted).frame(minHeight: 36, alignment: .leading)
                }
                .buttonStyle(.pressable)
            }
            if !draft.unreadable.isEmpty {
                Text("\(draft.unreadable.count) unreadable, skipped: " + draft.unreadable.map { AdoptSelection.pathTail($0) }.joined(separator: ", "))
                    .font(Theme.mono(12)).foregroundStyle(Theme.muted).fixedSize(horizontal: false, vertical: true)
            }
        }
        if !draft.engines.isEmpty {
            FormSection(label: "engine", trailing: "optional") {
                ScrollView(.horizontal, showsIndicators: false) {
                    ChoiceTiles(options: [""] + draft.engines.map(\.id), selection: $draft.adoptEngine, label: { id in
                        id.isEmpty ? "default" : (draft.engines.first { $0.id == id }?.name.lowercased() ?? id)
                    }, fill: false)
                }
            }
        }
    }
}
