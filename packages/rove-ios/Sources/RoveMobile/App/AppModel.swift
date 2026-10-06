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
    /// Reviewer demo: connected to the in-app fixture bridge. Never persisted; a cold launch starts unpaired.
    private(set) var demo = false
    /// Set when a task is created so the root stack can navigate to it.
    var path: [Route] = []
    /// A pairing link that still needs input (e.g. Cloudflare Access credentials); PairingView prefills it.
    var draftURL: String?
    /// Open quill sheets, bottom to top; `RootView` draws `Theme.scrim` while any is open.
    var sheets: [UUID] = []
    /// The sheet a scrim tap asked to close.
    var dismissSheet: UUID?

    init() {
        store = TaskStore(client: client)
        inbox = InboxState(client: client)
        store.onNotice = { [weak self] in
            guard let self, !self.demo else { return }
            self.notifier.post($0)
        }
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

    /// Validates, persists everything to the Keychain, and connects. Leaves demo mode first.
    func connect(_ p: Pairing) throws {
        try p.validate()
        exitDemo()
        keychain.save(p)
        pairing = p
        client.connect(p)
    }

    /// Enters demo mode: the app runs against the fixture bridge inside the app, with no network.
    func startDemo() {
        guard pairing == nil, let fixture = DemoFixture.bundled() else { return }
        demo = true
        client.connectDemo(fixture)
    }

    /// Leaves demo mode for the pairing screen and drops everything the fixture put on screen.
    func exitDemo() {
        guard demo else { return }
        demo = false
        client.disconnect()
        store.reset()
        path = []
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
        if model.pairing == nil && !model.demo {
            NavigationStack { PairingView(isOnboarding: true) }
                .overlay { SheetScrim() }
        } else {
            @Bindable var m = model
            VStack(spacing: 0) {
                if model.demo { DemoStrip() }
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
            }
            .background(Theme.paper.ignoresSafeArea())
            .overlay { SheetScrim() }
            .overlay(alignment: .bottom) { ToastHost() }
        }
    }
}
