import SwiftUI

/// Shown when the daemon has no tasks at all: what rove does, which engines it can drive, and where
/// to start. Engines come from `engines.list`; `ready == false` (installed but not signed in) is
/// shown muted with a note, `nil` (older bridge, unknown) counts as usable.
struct TaskWelcomeView: View {
    @Environment(AppModel.self) private var model
    @State private var engines: [Engine] = []

    /// `[ claude ] [ codex ]` — names of the engines that are usable (`ready != false`), lowercased.
    static func engineLine(_ engines: [Engine]) -> String {
        engines.filter { $0.ready != false }.map { "[ \($0.name.lowercased()) ]" }.joined(separator: " ")
    }

    /// `[ codex ] not signed in` — one line per engine that reported `ready == false`.
    static func notReadyLines(_ engines: [Engine]) -> [String] {
        engines.filter { $0.ready == false }.map { "[ \($0.name.lowercased()) ] not signed in" }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Theme.kicker("welcome", color: Theme.accent)
            Text("rove runs coding agents side by side — every task gets its own git worktree and branch.")
                .font(Theme.mono(13)).foregroundStyle(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)
            if !engines.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Theme.kicker("engines")
                    if !Self.engineLine(engines).isEmpty {
                        Text(Self.engineLine(engines))
                            .font(Theme.mono(13, .medium)).foregroundStyle(Theme.ink)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("welcomeEngines")
                    }
                    ForEach(Self.notReadyLines(engines), id: \.self) { line in
                        Text(line).font(Theme.mono(12)).foregroundStyle(Theme.muted)
                    }
                }
            }
            Text("start one with the new task bar below.")
                .font(Theme.mono(12)).foregroundStyle(Theme.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .tile(radius: 14)
        .padding(.horizontal, 16)
        .padding(.top, 20)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("welcome")
        .task {
            // A welcome panel is a nicety: when the list can't load, show it without engines.
            engines = (try? await model.client.request("engines.list", as: EnginesResult.self).engines) ?? []
        }
    }
}
