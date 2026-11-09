import SwiftUI

/// A registered machine as `machines.list` reports it.
struct MachineRow: Codable, Hashable, Identifiable {
    var alias: String
    var hostLabel: String
    var state: String
    var version: String?
    /// Why it is not online (`refused`, `auth-denied`, `lost`…). Absent from older bridges.
    var reason: String?

    var id: String { alias }
}

struct MachinesResult: Codable { var machines: [MachineRow] }

enum MachinesLogic {
    /// `narwhal · v0.9.185`, `narwhal · offline`, `narwhal · ⚠ v0.9.100 (protocol mismatch)`.
    static func label(_ m: MachineRow) -> String {
        let name = m.hostLabel.isEmpty ? m.alias : m.hostLabel
        switch m.state {
        case "online": return m.version.map { "\(name) · v\($0)" } ?? name
        case "mismatch":
            let word = String(localized: "protocol mismatch")
            return m.version.map { "\(name) · ⚠ v\($0) (\(word))" } ?? "\(name) · ⚠ \(word)"
        case "connecting": return "\(name) · \(String(localized: "connecting…"))"
        case "unsupported": return "\(name) · \(String(localized: "unsupported"))"
        default: return "\(name) · \(String(localized: "offline"))"
        }
    }

    /// The sentence for a failure reason; nil for one this app has no sentence for.
    static func reason(_ reason: String?) -> String? {
        switch reason {
        case "refused": String(localized: "ssh was refused (nothing is listening or a firewall is in the way)")
        case "timeout": String(localized: "ssh timed out")
        case "host-key-changed": String(localized: "its ssh host key changed; check it, then update known_hosts")
        case "host-key-unverified": String(localized: "its ssh host key is not known yet; connect once by hand to trust it")
        case "auth-denied": String(localized: "ssh refused the login (no key or password accepted)")
        case "unresolved": String(localized: "its hostname does not resolve")
        case "ssh-failed": String(localized: "ssh failed")
        case "no-rove": String(localized: "rove is not installed there")
        case "no-daemon": String(localized: "its rove daemon is not running")
        case "bad-status": String(localized: "it answered with something rove could not read")
        case "handshake": String(localized: "the link came up but the handshake failed")
        case "no-forwarding": String(localized: "ssh forwarding is disabled there")
        case "lost": String(localized: "the link dropped; reconnecting")
        default: nil
        }
    }

    /// The tasks the feed holds for one machine; a routine's run stays out, as in the task list.
    static func tasks(_ rows: [TaskRow], machine: String) -> [TaskRow] {
        rows.filter { $0.machine?.id == machine && !$0.routine }
    }
}

/// Every registered machine: its state, why it is not online, and the tasks it holds.
struct MachinesView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var machines: [MachineRow]?
    @State private var error: String?

    /// Machines change state on SSH timescales; the bridge holds the hub's latest.
    private static let pollSeconds = 10

    var body: some View {
        VStack(spacing: 0) {
            ScreenHeader(back: { dismiss() }) {
                Text("machines").font(Theme.face(16, .semibold)).foregroundStyle(Theme.ink)
                    .accessibilityAddTraits(.isHeader)
            } trailing: { EmptyView() }
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 18) {
                    if let error { ErrorLine(text: error) }
                    if machines?.isEmpty == true {
                        EmptyState(title: String(localized: "only this machine"), detail: String(localized: "run `rove machine add` to add one"))
                    }
                    ForEach(machines ?? []) { section($0) }
                }
                .padding(20)
            }
        }
        .background(Theme.paper.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .task {
            while !Task.isCancelled {
                await load()
                try? await Task.sleep(for: .seconds(Self.pollSeconds))
            }
        }
    }

    private func section(_ m: MachineRow) -> some View {
        let tasks = MachinesLogic.tasks(model.store.tasks, machine: m.alias)
        return VStack(alignment: .leading, spacing: 6) {
            Text(MachinesLogic.label(m)).font(Theme.mono(14, .semibold))
                .foregroundStyle(m.state == "online" ? Theme.ink : Theme.accent)
            if let reason = MachinesLogic.reason(m.reason) {
                Text(reason).font(Theme.face(14)).foregroundStyle(Theme.muted)
            }
            if tasks.isEmpty {
                Text("no tasks").font(Theme.mono(12)).foregroundStyle(Theme.muted)
            }
            ForEach(tasks) { task in
                Button { model.path.append(.task(task.id)) } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(task.displayTitle).font(Theme.face(15, .medium)).foregroundStyle(Theme.ink).lineLimit(1)
                        Text(task.branch).font(Theme.mono(12)).foregroundStyle(Theme.muted).lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                }
                .buttonStyle(.pressable)
                .accessibilityIdentifier("machineTask-\(task.id)")
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("machine-\(m.alias)")
    }

    private func load() async {
        do {
            machines = try await model.client.request("machines.list", [:], as: MachinesResult.self).machines
            error = nil
        } catch { self.error = error.localizedDescription }
    }
}
