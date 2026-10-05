import SwiftUI
import Observation

@MainActor @Observable
final class AppModel {
    let client = BridgeClient()
    let store: TaskStore
    @ObservationIgnored private let keychain = KeychainStore()
    @ObservationIgnored let notifier = Notifier()
    private(set) var pairing: Pairing?
    /// Set when a task is created so the root stack can navigate to it.
    var path: [Route] = []

    init() {
        store = TaskStore(client: client)
        store.onNotice = { [notifier] in notifier.post($0) }
        notifier.requestPermission()
        if ProcessInfo.processInfo.arguments.contains("-resetPairing") { keychain.delete() }
        if let p = keychain.load() {
            pairing = p
            client.connect(p)
        }
    }

    func pair(text: String) throws {
        let p = try PairingParser.parse(text)
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
    case terminal(taskId: String, tab: TabRow)
    case diff(taskId: String)
}

@main
struct RoveMobileApp: App {
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .onOpenURL { url in try? model.pair(text: url.absoluteString) }
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
                        case .terminal(let taskId, let tab): TerminalScreen(taskId: taskId, tab: tab)
                        case .diff(let taskId): DiffFilesView(taskId: taskId)
                        }
                    }
            }
        }
    }
}
