import SwiftUI
import Observation
import UIKit

/// One place that owns "which task action sheet is up". The task detail `…` menu and the task-row
/// long-press menu both embed `TaskActionItems`, and one `.taskActionSheets(host)` on the screen
/// presents whatever the items asked for. Owner: Detail/TaskActions*.swift (fill in, keep this API).
@MainActor @Observable
final class TaskActionHost {
    /// What is being asked for, and of which task / project (repo path).
    /// `delete`, `removeWorktree` and `forgetProject` start the two-step confirmation (dialog, then a red
    /// sheet); the `confirm…` cases are the sheet step.
    enum Request: Identifiable, Equatable {
        case rename(taskId: String)
        case branch(taskId: String)
        case engine(taskId: String)
        case modelEffort(taskId: String)
        case status(taskId: String)
        case info(taskId: String)
        case delete(taskId: String)
        case removeWorktree(taskId: String)
        case forgetProject(repo: String)
        case notes(repo: String)
        case confirmDelete(taskId: String)
        case confirmRemoveWorktree(taskId: String)
        case confirmForgetProject(repo: String)

        var id: String { String(describing: self) }

        /// The sheet step that follows this first-step confirmation; nil when this is not a first step.
        var confirmed: Request? {
            switch self {
            case .delete(let t): .confirmDelete(taskId: t)
            case .removeWorktree(let t): .confirmRemoveWorktree(taskId: t)
            case .forgetProject(let r): .confirmForgetProject(repo: r)
            default: nil
            }
        }
    }

    /// A short note over the screen: a mono confirmation, or a failure in `ErrorLine`.
    struct Banner: Equatable {
        var text: String
        var isError: Bool
        var stamp: Int
    }

    var request: Request?
    /// Called after a task was deleted / a project forgotten, so a detail screen can pop.
    var onRemoved: ((_ taskId: String?) -> Void)?
    /// Called to open a task (e.g. after "run again" spawned a new one).
    var onOpenTask: ((_ taskId: String) -> Void)?

    private(set) var banner: Banner?
    /// `task.get` per task, filled by the menu and the sheets so items can hide what does not apply.
    private(set) var details: [String: TaskDetail] = [:]

    @ObservationIgnored weak var model: AppModel?
    @ObservationIgnored private var fetchedAt: [String: Date] = [:]
    @ObservationIgnored private var stamp = 0

    init() {}

    func attach(_ model: AppModel) {
        if self.model !== model { self.model = model }
    }

    // MARK: - Detail cache

    /// `task.get`, throwing so a sheet can show the failure.
    @discardableResult
    func fetchDetail(_ taskId: String) async throws -> TaskDetail {
        guard let client = model?.client else { throw BridgeError.notConnected }
        let r = try await client.request("task.get", ["taskId": taskId], as: TaskGetResult.self)
        details[taskId] = r.task
        fetchedAt[taskId] = Date()
        return r.task
    }

    /// Best-effort cache fill for the menu; throttled so a menu opening many times asks once.
    func loadDetail(_ taskId: String) async {
        if let at = fetchedAt[taskId], Date().timeIntervalSince(at) < 4 { return }
        fetchedAt[taskId] = Date()
        _ = try? await fetchDetail(taskId)
    }

    /// After a sheet or action changed the task: refresh the list and re-read its detail.
    func didMutate(_ taskId: String?) async {
        if let taskId { fetchedAt[taskId] = nil }
        await model?.store.refresh()
        if let taskId { _ = try? await fetchDetail(taskId) }
    }

    // MARK: - Banner

    func show(_ text: String, isError: Bool = false) {
        stamp += 1
        let mine = stamp
        withAnimation(Theme.spring) { banner = Banner(text: text, isError: isError, stamp: mine) }
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: isError ? 6_000_000_000 : 2_200_000_000)
            if let self, self.banner?.stamp == mine { withAnimation(Theme.spring) { self.banner = nil } }
        }
    }

    private func fail(_ error: Error) { show(error.localizedDescription, isError: true) }

    // MARK: - Direct actions (no sheet)

    func togglePin(_ taskId: String) async {
        guard let model else { return }
        let next = TaskActionLogic.pinItem(pinned: model.store.task(id: taskId)?.pinned ?? false).next
        do {
            _ = try await model.client.request("task.pin", ["taskId": taskId, "pinned": next], as: EmptyResult.self)
            await didMutate(taskId)
        } catch { fail(error) }
    }

    /// `direction`: `up`, `down` or `top`.
    func move(_ taskId: String, _ direction: String) async {
        guard let model else { return }
        do {
            _ = try await model.client.request("task.move", ["taskId": taskId, "direction": direction], as: EmptyResult.self)
            await didMutate(taskId)
        } catch { fail(error) }
    }

    func copyBranch(_ taskId: String) {
        let branch = model?.store.task(id: taskId)?.branch ?? details[taskId]?.branch ?? ""
        guard !branch.isEmpty else { show("this task has no branch", isError: true); return }
        UIPasteboard.general.string = branch
        show("copied branch · \(branch)")
    }

    func copyPath(_ taskId: String) async {
        do {
            let path = try await fetchDetail(taskId).worktreePath
            guard !path.isEmpty else { show("no worktree yet — create one first", isError: true); return }
            UIPasteboard.general.string = path
            show("copied path · \(path)")
        } catch { fail(error) }
    }

    func ensureWorktree(_ taskId: String) async {
        guard let model else { return }
        do {
            let r = try await model.client.request("task.ensureWorktree", ["taskId": taskId], as: WorktreePathResult.self)
            await didMutate(taskId)
            show("worktree ready · \(r.worktreePath)")
        } catch { fail(error) }
    }

    /// Spawns a new task from this one's stored prompt, engine and title, then opens it.
    func runAgain(_ taskId: String) async {
        guard let model else { return }
        do {
            let detail = try await fetchDetail(taskId)
            guard let args = TaskActionLogic.runAgainArgs(detail) else {
                show("no stored prompt — nothing to run again", isError: true)
                return
            }
            let r = try await model.client.request("task.spawn", args, as: SpawnResult.self)
            await model.store.refresh()
            if let id = r.taskIds.first { onOpenTask?(id) } else { show("spawned, but the bridge returned no task") }
        } catch { fail(error) }
    }
}

/// Menu content for one task: embed inside `Menu { … }` or `.contextMenu { … }`.
struct TaskActionItems: View {
    var host: TaskActionHost
    var taskId: String

    var body: some View {
        let row = host.model?.store.task(id: taskId)
        let plan = TaskActionLogic.menu(kind: row?.kind ?? "task", pinned: row?.pinned ?? false,
                                        branch: row?.branch ?? "", detail: host.details[taskId])
        Group {
            Button { host.request = .info(taskId: taskId) } label: { Label("Info", systemImage: "info.circle") }
                .accessibilityIdentifier("actionInfo")
            Button { host.request = .rename(taskId: taskId) } label: { Label("Rename", systemImage: "pencil") }
                .accessibilityIdentifier("actionRename")
            if plan.branch {
                Button { host.request = .branch(taskId: taskId) } label: { Label("Branch…", systemImage: "arrow.triangle.branch") }
                    .accessibilityIdentifier("actionBranch")
            }
            Divider()
            Button { host.request = .engine(taskId: taskId) } label: { Label("Change engine…", systemImage: "cpu") }
                .accessibilityIdentifier("actionEngine")
            Button { host.request = .modelEffort(taskId: taskId) } label: { Label("Model & effort…", systemImage: "slider.horizontal.3") }
                .accessibilityIdentifier("actionModel")
            Button { host.request = .status(taskId: taskId) } label: { Label("Set status…", systemImage: "circle.dashed") }
                .accessibilityIdentifier("actionStatus")
            Divider()
            Button { Task { await host.togglePin(taskId) } } label: { Label(plan.pin.title, systemImage: plan.pin.symbol) }
                .accessibilityIdentifier("actionPin")
            if plan.move {
                Button { Task { await host.move(taskId, "up") } } label: { Label("Move up", systemImage: "arrow.up") }
                Button { Task { await host.move(taskId, "down") } } label: { Label("Move down", systemImage: "arrow.down") }
                Button { Task { await host.move(taskId, "top") } } label: { Label("Move to top", systemImage: "arrow.up.to.line") }
            }
            if plan.showsCopyGroup {
                Divider()
                if plan.copyBranch {
                    Button { host.copyBranch(taskId) } label: { Label("Copy branch", systemImage: "doc.on.doc") }
                        .accessibilityIdentifier("actionCopyBranch")
                }
                if plan.copyPath {
                    Button { Task { await host.copyPath(taskId) } } label: { Label("Copy path", systemImage: "folder") }
                        .accessibilityIdentifier("actionCopyPath")
                }
                switch plan.runAgain {
                case .hidden: EmptyView()
                case .available:
                    Button { Task { await host.runAgain(taskId) } } label: { Label("Run again", systemImage: "arrow.clockwise") }
                        .accessibilityIdentifier("actionRunAgain")
                case .unavailable(let hint):
                    Button {} label: { Label("Run again (\(hint))", systemImage: "arrow.clockwise") }
                        .disabled(true)
                }
            }
            if plan.showsWorktreeGroup {
                Divider()
                if plan.createWorktree {
                    Button { Task { await host.ensureWorktree(taskId) } } label: { Label("Create worktree", systemImage: "folder.badge.plus") }
                        .accessibilityIdentifier("actionCreateWorktree")
                }
                if plan.removeWorktree {
                    Button(role: .destructive) { host.request = .removeWorktree(taskId: taskId) } label: {
                        Label("Remove worktree", systemImage: "folder.badge.minus")
                    }
                    .accessibilityIdentifier("actionRemoveWorktree")
                }
            }
            Divider()
            Button(role: .destructive) { host.request = .delete(taskId: taskId) } label: {
                Label(plan.delete.menuTitle, systemImage: plan.delete.menuSymbol)
            }
            .accessibilityIdentifier("deleteButton")
        }
        .task(id: taskId) { await host.loadDetail(taskId) }
    }
}

/// Menu content for a project header: field notes, remove project.
struct ProjectActionItems: View {
    var host: TaskActionHost
    var repo: String

    var body: some View {
        Button { host.request = .notes(repo: repo) } label: { Label("Field notes", systemImage: "note.text") }
            .accessibilityIdentifier("projectNotes")
        Divider()
        Button(role: .destructive) { host.request = .forgetProject(repo: repo) } label: {
            Label(TaskActionLogic.forgetProjectPlan().menuTitle, systemImage: "trash")
        }
        .accessibilityIdentifier("projectRemove")
    }
}

extension View {
    /// Presents the sheets / confirmations for whatever `host.request` asks for.
    func taskActionSheets(_ host: TaskActionHost) -> some View { modifier(TaskActionSheets(host: host)) }
}

/// One `sheet(item:)` for every sheet step, one confirmation dialog for every first step, one banner.
private struct TaskActionSheets: ViewModifier {
    var host: TaskActionHost
    @Environment(AppModel.self) private var model

    private var firstStep: TaskActionHost.Request? {
        host.request.flatMap { $0.confirmed == nil ? nil : $0 }
    }

    private var sheetItem: Binding<TaskActionHost.Request?> {
        Binding(
            get: { host.request.flatMap { $0.confirmed == nil ? $0 : nil } },
            set: { if $0 == nil, host.request?.confirmed == nil { host.request = nil } })
    }

    private var dialogShown: Binding<Bool> {
        Binding(
            get: { firstStep != nil },
            set: { if !$0, host.request?.confirmed != nil { host.request = nil } })
    }

    private func plan(for request: TaskActionHost.Request) -> TaskActionLogic.ConfirmPlan {
        switch request {
        case .delete(let id), .confirmDelete(let id): TaskActionLogic.deletePlan(kind: model.store.task(id: id)?.kind ?? "task")
        case .removeWorktree, .confirmRemoveWorktree: TaskActionLogic.removeWorktreePlan()
        default: TaskActionLogic.forgetProjectPlan()
        }
    }

    func body(content: Content) -> some View {
        let _ = host.attach(model)
        let first = firstStep
        let firstPlan = first.map(plan(for:))
        content
            .sheet(item: sheetItem) { request in sheet(for: request) }
            .confirmationDialog(firstPlan?.dialogTitle ?? "", isPresented: dialogShown, titleVisibility: .visible) {
                if let first, let firstPlan {
                    Button(firstPlan.dialogButton, role: .destructive) { host.request = first.confirmed }
                }
            } message: {
                Text(firstPlan?.dialogMessage ?? "")
            }
            .overlay(alignment: .top) { bannerView }
    }

    @ViewBuilder private var bannerView: some View {
        if let b = host.banner {
            Group {
                if b.isError { ErrorLine(text: b.text) } else {
                    Text(b.text).font(Theme.mono(12)).foregroundStyle(Theme.ink)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(.horizontal, 14).padding(.vertical, 10)
            .tile()
            .padding(.horizontal, 16).padding(.top, 56)
            .transition(.opacity)
            .allowsHitTesting(false)
            .accessibilityIdentifier("actionBanner")
        }
    }

    @ViewBuilder private func sheet(for request: TaskActionHost.Request) -> some View {
        switch request {
        case .rename(let id): RenameTaskSheet(host: host, taskId: id)
        case .branch(let id): BranchSheet(host: host, taskId: id)
        case .engine(let id): EngineSheet(host: host, taskId: id)
        case .modelEffort(let id): ModelEffortSheet(host: host, taskId: id)
        case .status(let id): StatusSheet(host: host, taskId: id)
        case .info(let id): TaskInfoSheet(host: host, taskId: id)
        case .notes(let repo): FieldNotesView(repo: repo)
        case .confirmDelete(let id):
            DestructiveConfirmSheet(plan: plan(for: request), taskId: id, repo: model.store.task(id: id)?.repo) {
                host.onRemoved?(id)
            }
        case .confirmRemoveWorktree(let id):
            DestructiveConfirmSheet(plan: plan(for: request), taskId: id, repo: nil) {
                Task { await host.didMutate(id) }
                host.show("worktree removed · task and branch kept")
            }
        case .confirmForgetProject(let repo):
            DestructiveConfirmSheet(plan: plan(for: request), taskId: nil, repo: repo) { host.onRemoved?(nil) }
        case .delete, .removeWorktree, .forgetProject:
            EmptyView()
        }
    }
}
