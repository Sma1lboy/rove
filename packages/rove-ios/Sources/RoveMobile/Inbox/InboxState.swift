import Foundation
import Observation
import SwiftUI

/// A `rove api notify` toast, pushed by the bridge as the `notice` event. Only `title` and `at` are
/// guaranteed; an older bridge never sends the event at all.
struct Notice: Codable, Equatable, Identifiable {
    var title: String
    var body: String?
    var kind: String
    var taskId: String?
    var source: String?
    var at: Double

    var id: Double { at }

    init(title: String, body: String? = nil, kind: String = "done", taskId: String? = nil, source: String? = nil, at: Double) {
        self.title = title; self.body = body; self.kind = kind; self.taskId = taskId; self.source = source; self.at = at
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        title = try c.decode(String.self, forKey: .title)
        body = try c.decodeIfPresent(String.self, forKey: .body)
        kind = try c.decodeIfPresent(String.self, forKey: .kind) ?? "done"
        taskId = try c.decodeIfPresent(String.self, forKey: .taskId)
        source = try c.decodeIfPresent(String.self, forKey: .source)
        at = try c.decodeIfPresent(Double.self, forKey: .at) ?? Date().timeIntervalSince1970 * 1000
    }
}

/// Phone-local Inbox state: the visit log behind RECENT, the F7 cursor and the in-app toast.
@MainActor @Observable
final class InboxState {
    private(set) var visits: [Visit]
    private(set) var toast: Notice?
    /// Key of the item F7 last opened, so a repeat press moves on.
    var lastJumpKey: String?

    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private var observer: UUID?
    @ObservationIgnored private weak var client: BridgeClient?
    @ObservationIgnored private var hideTask: Task<Void, Never>?
    private static let visitsKey = "inboxVisits"
    static let toastSeconds: Double = 5

    init(client: BridgeClient? = nil, defaults: UserDefaults = .standard) {
        self.defaults = defaults
        self.client = client
        visits = defaults.data(forKey: Self.visitsKey).flatMap { try? JSONDecoder().decode([Visit].self, from: $0) } ?? []
        observer = client?.observe { [weak self] event in
            if case .notice(let n) = event { self?.show(n) }
        }
    }

    func record(taskId: String, tabId: String?, now: Date = Date()) {
        visits = InboxLogic.appending(Visit(taskId: taskId, tabId: tabId, at: now.timeIntervalSince1970 * 1000), to: visits)
        defaults.set(try? JSONEncoder().encode(visits), forKey: Self.visitsKey)
    }

    func show(_ notice: Notice) {
        withAnimation(Theme.spring) { toast = notice }
        hideTask?.cancel()
        hideTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(Self.toastSeconds))
            if !Task.isCancelled { self?.hide(notice) }
        }
    }

    func hide(_ notice: Notice) {
        guard toast == notice else { return }
        withAnimation(Theme.spring) { toast = nil }
    }
}

extension AppModel {
    /// Enter on an ATTENTION row: the exact tab (a task-level episode leaves the task's current tab),
    /// then the item is cleared. A routine episode has no task; it opens the Routines page.
    func open(attention item: AttentionItem) {
        inbox.lastJumpKey = InboxLogic.key(item)
        guard let taskId = item.taskId else { path.append(.routines); return }
        path.append(item.tabId.map { Route.taskTab(taskId, $0) } ?? .task(taskId))
        Task { await store.dismissAttention(item) }
    }

    /// F7: jump to the first pending item across every project — the oldest blocked one, else the oldest
    /// finished turn — and walk on at each repeat press. False when nothing is pending.
    @discardableResult
    func openNextPending() -> Bool {
        let sorted = InboxLogic.sorted(store.attention, taskOrder: TaskListLogic.sorted(store.tasks).map(\.id))
        guard let item = InboxLogic.next(after: inbox.lastJumpKey, in: sorted) else { return false }
        open(attention: item)
        return true
    }

    /// Showing a tab logs it for RECENT and resolves what was pending on it, as visiting does on the
    /// desktop: a tab-level episode on that tab, or a task-level one on its task.
    func visit(taskId: String, tabId: String) {
        inbox.record(taskId: taskId, tabId: tabId)
        for item in store.attention where item.taskId == taskId && (item.tabId == nil || item.tabId == tabId) {
            Task { await store.dismissAttention(item) }
        }
    }
}

/// The toast that `rove api notify` raises: a mono tag for the kind, the title, an optional second line.
/// `error` is a failure and takes the error slot; every other kind reads neutrally. Tap opens the
/// task it names, if any.
struct ToastHost: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        if let n = model.inbox.toast {
            Button {
                model.inbox.hide(n)
                if let id = n.taskId, model.store.task(id: id) != nil { model.path.append(.task(id)) }
            } label: {
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 8) {
                        Text(n.kind.replacingOccurrences(of: "_", with: " "))
                            .font(Theme.mono(11, .semibold))
                            .foregroundStyle(n.kind == "error" ? Theme.error : Theme.accent)
                        if let source = n.source {
                            Text(source).font(Theme.mono(11)).foregroundStyle(Theme.muted).lineLimit(1)
                        }
                    }
                    Text(n.title).font(Theme.face(15, .medium)).foregroundStyle(Theme.ink).lineLimit(2)
                    if let body = n.body {
                        Text(body).font(Theme.face(13)).foregroundStyle(Theme.muted).lineLimit(2)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 14).padding(.vertical, 10)
                .tile()
                .shadow(color: Theme.shadow, radius: 8, y: 3)
            }
            .buttonStyle(.pressable)
            .padding(.horizontal, 12)
            // Above the bottom bars (new task / composer), clear of the header's bell and `…`.
            .padding(.bottom, 84)
            .transition(.move(edge: .bottom).combined(with: .opacity))
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("noticeToast")
        }
    }
}
