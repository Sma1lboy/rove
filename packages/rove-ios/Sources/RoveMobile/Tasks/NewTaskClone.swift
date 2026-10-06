import SwiftUI

/// Mode `clone`: url, parent directory, folder. Soft checks here; the bridge's refusals show in the error line.
struct NewTaskCloneForm: View {
    @Bindable var draft: NewTaskDraft

    var body: some View {
        FormSection(label: "git url") {
            FieldBox {
                TextField("", text: Binding(get: { draft.clone.url }, set: { draft.clone.setURL($0) }),
                          prompt: Text("https://github.com/owner/repo.git").foregroundStyle(Theme.muted))
                    .keyboardType(.URL)
                    .accessibilityIdentifier("cloneURLField")
            }
            soft(draft.clone.url, draft.clone.urlIssue)
        }
        FormSection(label: "parent directory") {
            FieldBox {
                TextField("", text: $draft.clone.parentDir, prompt: Text("/Users/you/code").foregroundStyle(Theme.muted))
                    .accessibilityIdentifier("cloneParentField")
            }
            soft(draft.clone.parentDir, draft.clone.parentIssue)
        }
        FormSection(label: "folder name") {
            FieldBox {
                TextField("", text: Binding(get: { draft.clone.folder }, set: { draft.clone.setFolder($0) }),
                          prompt: Text("derived from the url").foregroundStyle(Theme.muted))
                    .accessibilityIdentifier("cloneFolderField")
            }
            soft(draft.clone.folder, draft.clone.folderIssue)
        }
        Hint(text: "git clone runs on the Mac. then the checkout opens in the new-task form.")
    }

    @ViewBuilder private func soft(_ text: String, _ issue: String?) -> some View {
        if !text.isEmpty, let issue { Text(issue).font(Theme.mono(12)).foregroundStyle(Theme.muted) }
    }
}
