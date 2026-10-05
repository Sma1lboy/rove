import SwiftUI

extension TaskGroup {
    var color: Color {
        switch self {
        case .waitingOnYou: .orange
        case .landing: .purple
        case .readyForReview: .green
        case .working: .blue
        case .idle: .gray
        case .unknown: .secondary
        }
    }
}

struct Chip: View {
    var text: String
    var color: Color
    var body: some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(color.opacity(0.18), in: Capsule())
            .foregroundStyle(color)
    }
}

func checkStateColor(_ s: String) -> Color {
    let l = s.lowercased()
    if l.contains("pass") || l.contains("success") || l.contains("green") { return .green }
    if l.contains("fail") || l.contains("error") || l.contains("red") { return .red }
    if l.contains("pend") || l.contains("running") || l.contains("progress") { return .orange }
    return .secondary
}

struct PRChip: View {
    var pr: TaskPR
    var body: some View {
        Chip(text: [pr.number.map { "#\($0)" }, pr.checkState].compactMap { $0 }.joined(separator: " · "),
             color: checkStateColor(pr.checkState))
    }
}

struct TaskRowView: View {
    var row: TaskRow
    @Environment(AppModel.self) private var model
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(row.displayTitle).font(.headline).lineLimit(2)
                Spacer()
                Chip(text: row.group.title, color: row.group.color)
            }
            HStack(spacing: 8) {
                if !row.branch.isEmpty { Label(row.branch, systemImage: "arrow.triangle.branch").lineLimit(1) }
                if let e = row.engine { Text(e.name) }
            }
            .font(.caption).foregroundStyle(.secondary)
            HStack(spacing: 8) {
                TimelineView(.periodic(from: .now, by: 15)) { ctx in
                    if let t = model.store.activityText(row, now: ctx.date) {
                        Text(t).font(.caption).foregroundStyle(.secondary)
                    }
                }
                if let pr = row.pr { PRChip(pr: pr) }
                if row.deleting { Chip(text: "deleting", color: .red) }
            }
        }
        .padding(.vertical, 2)
    }
}

struct TaskListView: View {
    @Environment(AppModel.self) private var model
    @State private var showAttention = false
    @State private var showSettings = false
    @State private var showNew = false

    var body: some View {
        @Bindable var store = model.store
        List {
            if let e = store.error { Text(e).font(.footnote).foregroundStyle(.red) }
            ForEach(store.sections, id: \.group) { section in
                Section {
                    ForEach(section.rows) { row in
                        NavigationLink(value: Route.task(row.id)) { TaskRowView(row: row) }
                    }
                } header: {
                    Text(section.group.title).foregroundStyle(section.group.color)
                }
            }
            if store.loaded && store.visible.isEmpty {
                ContentUnavailableView("No tasks", systemImage: "tray")
            }
        }
        .overlay {
            if !store.loaded { ProgressView(model.client.state.label) }
        }
        .refreshable { await store.refresh() }
        .navigationTitle("Tasks")
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button { showSettings = true } label: { Image(systemName: "gearshape") }
                    .accessibilityLabel("Settings")
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button { showAttention = true } label: {
                    Image(systemName: "bell")
                        .overlay(alignment: .topTrailing) {
                            if store.attentionCount > 0 {
                                Text("\(store.attentionCount)")
                                    .font(.system(size: 10, weight: .bold)).foregroundStyle(.white)
                                    .padding(.horizontal, 4).background(Color.red, in: Capsule())
                                    .offset(x: 8, y: -8)
                            }
                        }
                }
                .accessibilityLabel("Attention")
            }
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Picker("Repo", selection: $store.repoFilter) {
                        Text("All").tag(String?.none)
                        ForEach(store.repos, id: \.self) { Text(URL(fileURLWithPath: $0).lastPathComponent).tag(String?.some($0)) }
                    }
                } label: {
                    Image(systemName: store.repoFilter == nil ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
                }
                .accessibilityLabel("Filter by repo")
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button { showNew = true } label: { Image(systemName: "plus") }.accessibilityLabel("New task")
                    .accessibilityIdentifier("newTaskButton")
            }
        }
        .sheet(isPresented: $showAttention) { AttentionSheet() }
        .sheet(isPresented: $showSettings) { NavigationStack { PairingView() } }
        .sheet(isPresented: $showNew) {
            NewTaskView { id in model.path.append(.task(id)) }
        }
    }
}

struct AttentionSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                if model.store.attention.isEmpty { ContentUnavailableView("Nothing needs you", systemImage: "checkmark.circle") }
                ForEach(Array(model.store.attention.enumerated()), id: \.offset) { _, item in
                    Button {
                        if let id = item.taskId { dismiss(); model.path.append(.task(id)) }
                    } label: {
                        HStack {
                            Circle().fill(item.unread ? Color.red : Color.clear).frame(width: 8, height: 8)
                            VStack(alignment: .leading) {
                                Text(item.taskId.flatMap { model.store.task(id: $0)?.displayTitle } ?? item.taskId ?? "—")
                                Text(item.state).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(Date(timeIntervalSince1970: item.at > 1e11 ? item.at / 1000 : item.at), style: .relative)
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .swipeActions { Button("Dismiss") { Task { await model.store.dismissAttention(item) } } }
                }
            }
            .navigationTitle("Attention")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}
