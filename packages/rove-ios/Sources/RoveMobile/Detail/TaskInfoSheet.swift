import SwiftUI

/// Read-only facts about one task: PR state, the worker's own report, changes, activity and tabs.
/// `task.get` and `task.info` load independently, so one failing leaves the other's sections up.
struct TaskInfoSheet: View {
    var host: TaskActionHost
    let taskId: String
    @Environment(AppModel.self) private var model
    @State private var detail: TaskDetail?
    @State private var info: TaskInfoResult?
    @State private var detailError: String?
    @State private var infoError: String?
    @State private var loading = true
    @State private var expanded: Set<String> = []

    private var row: TaskRow? { model.store.task(id: taskId) }
    private var report: TaskReport? { detail?.report ?? row?.report }

    var body: some View {
        SheetScaffold(title: row?.displayTitle ?? detail?.title ?? "task info", kicker: "info") {
            if loading { BrailleSpinner(size: 13) }
            if let detailError { ErrorLine(text: detailError) }
            if let infoError { ErrorLine(text: infoError) }
            if let pr = detail?.pr {
                FormSection(label: "pull request") {
                    card(TaskActionLogic.prLines(pr).map { InfoRow(label: $0.label, value: $0.value) })
                }
            } else if !loading, detail != nil {
                FormSection(label: "pull request") { Hint(text: "No pull request for this task yet.") }
            }
            if let report {
                FormSection(label: "worker's claim", trailing: report.at) {
                    Text(report.summary).font(Theme.face(15)).foregroundStyle(Theme.ink)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(12)
                        .tile()
                    Hint(text: "What the worker says it delivered. Rove has not verified it.")
                }
            }
            if let info {
                FormSection(label: "state") {
                    card(stateRows(info))
                }
                FormSection(label: "tabs", trailing: "\(info.tabs.count)") {
                    if info.tabs.isEmpty {
                        EmptyState(title: "no tabs", detail: "this task has no terminal tabs")
                    } else {
                        VStack(spacing: 8) { ForEach(info.tabs) { tabCard($0) } }
                    }
                }
            }
        }
        .task { await load() }
    }

    private func stateRows(_ info: TaskInfoResult) -> [InfoRow] {
        let uncommitted = TaskActionLogic.uncommittedLine(info.changes)
        return [
            InfoRow(label: "running", value: TaskActionLogic.runningLine(info.running)),
            InfoRow(label: "activity", value: TaskActionLogic.activityLine(info.activity)),
            InfoRow(label: "uncommitted", value: uncommitted, added: info.changes?.added, deleted: info.changes?.deleted),
            InfoRow(label: "committed", value: TaskActionLogic.baseLine(info.base)),
        ]
    }

    private func card(_ rows: [InfoRow]) -> some View {
        VStack(alignment: .leading, spacing: 8) { ForEach(rows) { $0 } }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .tile()
    }

    private func tabCard(_ tab: TaskInfoTab) -> some View {
        let tail = TaskActionLogic.tailText(tab)
        let open = expanded.contains(tab.id)
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(tab.id).font(Theme.mono(13, .semibold)).foregroundStyle(Theme.ink)
                Text(tab.kind).font(Theme.mono(12)).foregroundStyle(Theme.muted)
                Spacer(minLength: 4)
                Text(TaskActionLogic.tabState(tab)).font(Theme.mono(12))
                    .foregroundStyle(tab.alive == false ? Theme.ink : Theme.muted)
                    .multilineTextAlignment(.trailing)
            }
            if let tail {
                Button {
                    withAnimation(Theme.spring) { if open { expanded.remove(tab.id) } else { expanded.insert(tab.id) } }
                } label: {
                    Text(open ? "hide output" : "show output").font(Theme.mono(12)).foregroundStyle(Theme.accent)
                        .frame(minHeight: 32, alignment: .leading)
                }
                .buttonStyle(.pressable)
                .accessibilityIdentifier("tail-\(tab.id)")
                if open {
                    ScrollView(.horizontal, showsIndicators: false) {
                        Text(tail).font(Theme.mono(11)).foregroundStyle(Theme.ink).fixedSize().padding(10)
                    }
                    .tile(Theme.inset)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .tile()
    }

    private func load() async {
        async let d: Void = loadDetail()
        async let i: Void = loadInfo()
        _ = await (d, i)
        loading = false
    }

    private func loadDetail() async {
        do { detail = try await host.fetchDetail(taskId) } catch { detailError = error.localizedDescription }
    }

    private func loadInfo() async {
        do { info = try await model.client.request("task.info", ["taskId": taskId], as: TaskInfoResult.self) }
        catch { infoError = error.localizedDescription }
    }
}

/// `label  value` in mono; `+N −N` values take the diff colors.
private struct InfoRow: View, Identifiable {
    var label: String
    var value: String
    var added: Int? = nil
    var deleted: Int? = nil
    var id: String { label }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(label).font(Theme.mono(12)).foregroundStyle(Theme.muted).frame(width: 92, alignment: .leading)
            if let added, let deleted, added > 0 || deleted > 0 {
                HStack(spacing: 8) {
                    Text("+\(added)").foregroundStyle(Theme.success)
                    Text("−\(deleted)").foregroundStyle(Theme.error)
                }
                .font(Theme.mono(13)).monospacedDigit()
            } else {
                Text(value).font(Theme.mono(13)).foregroundStyle(Theme.ink).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
    }
}
