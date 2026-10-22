import Foundation
import Observation

/// A first-party mod the Mac ships (Kanban, Issues), as `builtinMods.list` reports it.
struct BuiltinMod: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let description: String
    let installed: Bool
}

struct BuiltinModsPayload: Decodable {
    let mods: [BuiltinMod]
}

/// Which gated pages the Pages menu may offer: the Board needs `kanban`, GitHub issues needs `issues`.
enum ModGate: Equatable {
    /// Not answered yet: the gated pages stay hidden rather than flash in.
    case pending
    /// A Mac too old for the op: every page shows, as before mods existed.
    case legacy
    case loaded([BuiltinMod])

    func shows(_ id: String) -> Bool {
        switch self {
        case .pending: false
        case .legacy: true
        case .loaded(let mods): mods.contains { $0.id == id && $0.installed }
        }
    }

    /// The pages a mod owns, so the path can drop one whose mod went away.
    func allows(_ route: Route) -> Bool {
        switch route {
        case .board: shows("kanban")
        case .issues: shows("issues")
        default: true
        }
    }
}

@MainActor @Observable
final class BuiltinModsState {
    private(set) var gate: ModGate = .pending

    @ObservationIgnored private let client: BridgeClient
    @ObservationIgnored private var observer: UUID?

    init(client: BridgeClient) {
        self.client = client
        observer = client.observe { [weak self] event in
            guard let self, case .connected = event else { return }
            Task { await self.refresh() }
        }
    }

    var mods: [BuiltinMod] {
        if case .loaded(let mods) = gate { return mods }
        return []
    }

    /// A failed first read means an older Mac; a failed re-read keeps what was known.
    func refresh() async {
        do {
            gate = .loaded(try await client.request("builtinMods.list", as: BuiltinModsPayload.self).mods)
        } catch {
            if gate == .pending { gate = .legacy }
        }
    }

    func setInstalled(_ id: String, _ installed: Bool) async throws {
        _ = try await client.request("builtinMod.setInstalled", ["id": id, "installed": installed], as: EmptyResult.self)
        await refresh()
    }

    func reset() { gate = .pending }
}
