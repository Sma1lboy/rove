import SwiftUI

/// `rove api issue-create`: a title and an optional description, filed into the project's backlog.
struct NewStorySheet: View {
    let repo: String
    /// Called after the story exists, once this sheet has asked to close.
    var created: () -> Void
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var detail = ""
    @State private var busy = false
    @State private var error: String?

    private var ready: Bool { !BoardCardLogic.trim(title).isEmpty }

    var body: some View {
        SheetScaffold(title: "new story", kicker: URL(fileURLWithPath: repo).lastPathComponent, error: error,
                      primary: PrimaryBar(label: "file story", enabled: ready, busy: busy,
                                          identifier: "newStorySave") { Task { await create() } }) {
            FormSection(label: "title") {
                FieldBox {
                    TextField("", text: $title, prompt: Text("what to do").foregroundStyle(Theme.muted))
                        .accessibilityIdentifier("newStoryTitle")
                }
            }
            FormSection(label: "description") {
                PromptEditor(text: $detail, placeholder: "optional, what and why in a few lines")
                    .accessibilityIdentifier("newStoryDescription")
            }
            Hint(text: "Stories start in the backlog. Start a session from one when it is time.")
        }
    }

    private func create() async {
        busy = true
        error = nil
        defer { busy = false }
        var args: [String: Any] = ["repo": repo, "title": BoardCardLogic.trim(title)]
        let body = BoardCardLogic.trim(detail)
        if !body.isEmpty { args["body"] = body }
        do {
            _ = try await model.client.request("issue.create", args, as: EmptyResult.self)
            dismiss()
            created()
        } catch { self.error = error.localizedDescription }
    }
}
