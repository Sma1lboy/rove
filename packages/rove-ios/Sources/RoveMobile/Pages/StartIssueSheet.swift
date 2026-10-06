import SwiftUI

/// `workitem.start`: a Rove task from a GitHub issue. Only built-in engines are offered (the verb
/// takes built-in vendors); `default engine` omits `engine` and leaves the choice to the mac.
struct StartIssueSheet: View {
    let repo: String
    let item: WorkItem
    var started: (String) -> Void
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var engines: [Engine] = []
    /// `nil` is the default engine: the arg is left out.
    @State private var engine: String?
    @State private var loaded = false
    @State private var error: String?
    @State private var busy = false

    /// The built-in engines, then the default (`nil`).
    private var options: [String?] {
        var all: [String?] = engines.map { $0.id }
        all.append(nil)
        return all
    }

    private func tileLabel(_ id: String?) -> String {
        guard let id else { return "default engine" }
        return engines.first { $0.id == id }?.name.lowercased() ?? id
    }

    var body: some View {
        SheetScaffold(title: "#\(item.number) \(item.title)", kicker: "start task", error: error,
                      primary: PrimaryBar(label: "start task", busy: busy,
                                          identifier: "startIssueTask") { Task { await start() } }) {
            FormSection(label: "engine") {
                if loaded {
                    ScrollView(.horizontal, showsIndicators: false) {
                        ChoiceTiles(options: options, selection: $engine, label: tileLabel, fill: false)
                    }
                    .accessibilityIdentifier("enginePicker")
                } else {
                    BrailleSpinner(size: 13)
                }
            }
            Text("The issue body becomes the first prompt, marked as an untrusted report. Nothing is written back to GitHub.")
                .font(Theme.face(16)).foregroundStyle(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)
        }
        .task { await load() }
    }

    private func load() async {
        defer { loaded = true }
        do {
            engines = try await model.client.request("engines.list", as: EnginesResult.self).engines.filter(\.builtin)
            if engine == nil { engine = engines.first?.id }
        } catch { self.error = error.localizedDescription }
    }

    private func start() async {
        busy = true
        defer { busy = false }
        error = nil
        var args: [String: Any] = ["repo": repo, "number": item.number]
        if let engine { args["engine"] = engine }
        do {
            let result = try await model.client.request("workitem.start", args, as: WorkItemStartResult.self)
            dismiss()
            started(result.taskId)
        } catch { self.error = error.localizedDescription }
    }
}
