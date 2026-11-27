import SwiftUI
import AVFoundation
import Observation

/// The paired computers, newest first; the first is the one on screen. Keychain only: each link is a password.
@MainActor @Observable
final class ShellModel {
    private(set) var computers: [ShellComputer] = []
    @ObservationIgnored private let keychain = KeychainStore(account: "computers")

    var current: ShellComputer? { computers.first }

    init() {
        let args = ProcessInfo.processInfo.arguments
        if args.contains("-resetPairing") { keychain.delete() }
        computers = keychain.loadData().flatMap { try? JSONDecoder().decode([ShellComputer].self, from: $0) } ?? []
        // A phone paired with the native app keeps its computer (its socket URL is the same host the page lives on).
        if computers.isEmpty, let old = KeychainStore().load(), var c = URLComponents(url: old.endpoint, resolvingAgainstBaseURL: false) {
            c.queryItems = (c.queryItems ?? []) + [URLQueryItem(name: "token", value: old.token)]
            if let s = c.string, let computer = try? ShellLink.parse(s) { use(computer) }
        }
        // UI tests and the simulator, which has no camera: `-pairLink <link>`.
        if let i = args.firstIndex(of: "-pairLink"), i + 1 < args.count { try? pair(args[i + 1]) }
    }

    func pair(_ text: String) throws { use(try ShellLink.parse(text)) }

    /// Pairing the same computer again replaces its link (a rotated token) and brings it to the front.
    func use(_ computer: ShellComputer) {
        computers.removeAll { $0.id == computer.id }
        computers.insert(computer, at: 0)
        save()
    }

    func forget(_ computer: ShellComputer) {
        computers.removeAll { $0.id == computer.id }
        save()
    }

    private func save() {
        if computers.isEmpty { keychain.delete() } else if let d = try? JSONEncoder().encode(computers) { keychain.saveData(d) }
    }
}

struct ShellRoot: View {
    @State private var model = ShellModel()
    @State private var failure: String?
    @State private var reload = 0
    @State private var switching = false

    var body: some View {
        Group {
            if let computer = model.current {
                WebShellView(computer: computer, reloadToken: reload,
                             onFail: { msg in Task { @MainActor in failure = msg } },
                             onSwitch: { switching = true })
                    .ignoresSafeArea()
                    .overlay { if let failure { failed(computer, failure) } }
                    .sheet(isPresented: $switching) {
                        ComputersSheet(model: model) { switching = false }
                            .presentationDetents([.medium, .large])
                    }
            } else {
                ShellPairingView(model: model, onDone: nil)
            }
        }
        .background(Theme.paper.ignoresSafeArea())
        .onOpenURL { try? model.pair($0.absoluteString) }
    }

    private func failed(_ computer: ShellComputer, _ message: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            BracketChip(size: 19)
            Text("can't reach \(computer.display)").font(Theme.face(22, .semibold)).foregroundStyle(Theme.ink)
            Hint(text: String(localized: "Is rove --web still running on that computer, and is this phone on the same network or tailnet?"))
            ErrorLine(text: message)
            Spacer()
            PrimaryBar(label: String(localized: "retry"), identifier: "retryButton") { reload += 1 }
            Button { switching = true } label: { TileLabel(text: String(localized: "computers")) }
                .buttonStyle(.pressable)
                .accessibilityIdentifier("computersButton")
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Theme.paper.ignoresSafeArea())
    }
}

/// Every paired computer: open one, forget one, or pair another.
struct ComputersSheet: View {
    var model: ShellModel
    var close: () -> Void
    @State private var adding = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    Theme.kicker(String(localized: "computers"))
                    ForEach(model.computers) { c in
                        HStack {
                            Button { model.use(c); close() } label: {
                                HStack {
                                    Text(c.display).font(Theme.mono(14, .medium)).foregroundStyle(Theme.ink).lineLimit(1)
                                    Spacer()
                                    if c == model.current { Text("open").font(Theme.mono(12)).foregroundStyle(Theme.accent) }
                                }
                                .padding(.horizontal, 14).frame(minHeight: 48)
                            }
                            .buttonStyle(.pressable)
                            Button { model.forget(c) } label: { TileLabel(text: String(localized: "forget"), tint: Theme.error) }
                                .buttonStyle(.pressable)
                                .padding(.trailing, 8)
                        }
                        .tile()
                    }
                    Button { adding = true } label: { TileLabel(text: String(localized: "+ pair another computer")) }
                        .buttonStyle(.pressable)
                        .accessibilityIdentifier("pairAnotherButton")
                    Hint(text: String(localized: "Hold two fingers on the page to come back here."))
                }
                .padding(20)
            }
            .background(Theme.paper.ignoresSafeArea())
            .navigationDestination(isPresented: $adding) { ShellPairingView(model: model) { adding = false; close() } }
            .toolbar(.hidden, for: .navigationBar)
        }
    }
}

/// Scan the QR code the computer shows, or paste the link it prints.
struct ShellPairingView: View {
    var model: ShellModel
    var onDone: (() -> Void)?
    @State private var text = ""
    @State private var error: String?
    @State private var scanning = false

    private var cameraAvailable: Bool { AVCaptureDevice.default(for: .video) != nil }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    VStack(alignment: .leading, spacing: 8) {
                        BracketChip(size: 19).accessibilityAddTraits(.isHeader).padding(.bottom, 12)
                        Theme.kicker(String(localized: "pair a computer"))
                        Text("open rove on your phone").font(Theme.face(24, .semibold)).foregroundStyle(Theme.ink)
                        Text("Run `rove --web` on your computer, then scan the QR code it shows or paste the link it prints.")
                            .font(Theme.face(16)).foregroundStyle(Theme.ink)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if cameraAvailable {
                        Button { scanning = true } label: {
                            Label(String(localized: "scan qr code"), systemImage: "qrcode.viewfinder")
                                .font(Theme.mono(15, .semibold)).foregroundStyle(Theme.ink)
                                .frame(maxWidth: .infinity, minHeight: 56).tile()
                        }
                        .buttonStyle(.pressable)
                        .accessibilityIdentifier("scanButton")
                    }
                    FormSection(label: String(localized: "or paste the link")) {
                        FieldBox {
                            TextField("", text: $text, prompt: Text(verbatim: "http://host:7878/#token=…").foregroundStyle(Theme.muted), axis: .vertical)
                                .keyboardType(.URL)
                                .lineLimit(1...4)
                                .accessibilityIdentifier("pairingField")
                        }
                        HStack {
                            Button { text = UIPasteboard.general.string ?? text } label: { TileLabel(text: String(localized: "paste")) }
                                .buttonStyle(.pressable)
                            Spacer()
                        }
                        if !cameraAvailable { Hint(text: String(localized: "no camera here — paste the link instead")) }
                    }
                }
                .padding(.horizontal, 20).padding(.top, 20).padding(.bottom, 24)
            }
            .scrollDismissesKeyboard(.interactively)
            VStack(alignment: .leading, spacing: 8) {
                if let error { ErrorLine(text: error).accessibilityIdentifier("pairingError") }
                PrimaryBar(label: String(localized: "connect"),
                           enabled: !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                           identifier: "connectButton") { pair(text) }
            }
            .padding(.horizontal, 16).padding(.vertical, 8)
        }
        .background(Theme.paper.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .sheet(isPresented: $scanning) {
            QRScannerView { code in scanning = false; text = code; pair(code) }
                .ignoresSafeArea()
                .quillSheetChrome()
        }
    }

    private func pair(_ link: String) {
        do {
            try model.pair(link)
            error = nil
            text = ""
            onDone?()
        } catch { self.error = error.localizedDescription }
    }
}
