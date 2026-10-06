import SwiftUI
import Observation

@MainActor @Observable
final class AppModel {
    let client = BridgeClient()
    let store: TaskStore
    /// Phone-local Inbox state: visit log, F7 cursor, `notify` toast.
    let inbox: InboxState
    @ObservationIgnored private let keychain = KeychainStore()
    @ObservationIgnored let notifier = Notifier()
    private(set) var pairing: Pairing?
    /// Set when a task is created so the root stack can navigate to it.
    var path: [Route] = []
    /// A pairing link that still needs input (e.g. Cloudflare Access credentials); PairingView prefills it.
    var draftURL: String?

    init() {
        store = TaskStore(client: client)
        inbox = InboxState(client: client)
        store.onNotice = { [notifier] in notifier.post($0) }
        notifier.requestPermission()
        if ProcessInfo.processInfo.arguments.contains("-resetPairing") { keychain.delete() }
        if let p = keychain.load() {
            pairing = p
            client.connect(p)
        }
    }

    func pair(text: String) throws {
        try connect(try PairingParser.parse(text))
    }

    /// Validates, persists everything to the Keychain, and connects.
    func connect(_ p: Pairing) throws {
        try p.validate()
        keychain.save(p)
        pairing = p
        client.connect(p)
    }

    func reconnect() { if let p = pairing { client.connect(p) } }
    func disconnect() { client.disconnect() }

    func forget() {
        client.disconnect()
        keychain.delete()
        pairing = nil
        path = []
    }
}

enum Route: Hashable {
    case task(String)
    /// A task opened on one exact tab (Inbox, F7).
    case taskTab(String, String)
    case diff(taskId: String)
    case inbox
    case board
    case routines
    case issues
    case worktrees
    case settings
}

@main
struct RoveMobileApp: App {
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .tint(Theme.accent)
                .onOpenURL { url in
                    if (try? model.pair(text: url.absoluteString)) == nil { model.draftURL = url.absoluteString }
                }
        }
    }
}

struct RootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        if model.pairing == nil {
            NavigationStack { PairingView(isOnboarding: true) }
        } else {
            @Bindable var m = model
            NavigationStack(path: $m.path) {
                TaskListView()
                    .navigationDestination(for: Route.self) { route in
                        switch route {
                        case .task(let id): TaskDetailView(taskId: id)
                        case .taskTab(let id, let tab): TaskDetailView(taskId: id, tabId: tab)
                        case .diff(let taskId): DiffFilesView(taskId: taskId)
                        case .inbox: InboxView()
                        case .board: BoardView()
                        case .routines: RoutinesView()
                        case .issues: IssuesView()
                        case .worktrees: WorktreesView()
                        case .settings: SettingsView()
                        }
                    }
            }
            .overlay(alignment: .top) { ToastHost() }
        }
    }
}
