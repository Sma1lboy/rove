import SwiftUI
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
    /// Not kept: a relaunch is back on pairing.
    @State private var demo = false
    /// The page's own background (its `theme-color`), which follows the theme picked in rove-web; paper until it says.
    @State private var page: UIColor?
    /// For the can't-reach screen's details: when the page last loaded, and when this failure began.
    @State private var lastLoaded: Date?
    @State private var failedAt: Date?

    var body: some View {
        Group {
            if let computer = model.current {
                WebShellView(computer: computer, reloadToken: reload,
                             onFail: { msg in Task { @MainActor in
                                 if failure == nil, msg != nil { failedAt = Date() }
                                 failure = msg
                             } },
                             onSwitch: { switching = true }, onPage: { page = $0 },
                             onLoaded: { lastLoaded = Date() })
                    .ignoresSafeArea()
                    .overlay { if let failure { failed(computer, failure) } }
                    .sheet(isPresented: $switching) {
                        ComputersSheet(model: model) { switching = false }
                            .presentationDetents([.medium, .large])
                    }
            } else if demo {
                VStack(spacing: 0) {
                    DemoStrip(status: String(localized: "demo · not connected to a computer"),
                              action: String(localized: "connect a computer"), fill: pageColor) { demo = false; page = nil }
                    WebShellView(computer: DemoWeb.computer, reloadToken: 0, onFail: { _ in }, onSwitch: {},
                                 onPage: { page = $0 })
                        .ignoresSafeArea(edges: [.horizontal, .bottom])
                }
            } else {
                ShellPairingView(model: model, onDone: nil, onDemo: { demo = true })
            }
        }
        .background(pageColor.ignoresSafeArea())
        .onOpenURL { try? model.pair($0.absoluteString) }
    }

    private var pageColor: Color { page.map(Theme.color) ?? Theme.paper }

    private func failed(_ computer: ShellComputer, _ message: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            BracketChip(size: 19)
            Text("can't reach \(computer.display)").font(Theme.face(22, .semibold)).foregroundStyle(Theme.ink)
            Hint(text: String(localized: "Is rove --web still running on that computer, and is this phone on the same network or tailnet?"))
            ErrorLine(text: message)
            FailureDetails(text: failureDetails(computer, message))
            Spacer()
            PhoneButton(label: String(localized: "retry"), primary: true, identifier: "retryButton") { reload += 1 }
            PhoneButton(label: String(localized: "computers"), identifier: "computersButton") { switching = true }
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Theme.paper.ignoresSafeArea())
    }
}

extension ShellRoot {
    /// What the can't-reach screen knows, copyable for a report. The origin only: the paired link carries the token.
    fileprivate func failureDetails(_ computer: ShellComputer, _ message: String) -> String {
        let stamp = { (d: Date?) in d.map { ISO8601DateFormatter().string(from: $0) } }
        return [
            "\(String(localized: "computer")): \(computer.origin)",
            "\(String(localized: "error")): \(message)",
            "\(String(localized: "failed at")): \(stamp(failedAt) ?? "-")",
            "\(String(localized: "last loaded")): \(stamp(lastLoaded) ?? String(localized: "not since the app opened"))",
        ].joined(separator: "\n")
    }
}

/// A "details" disclosure under a failure, with a copy button.
struct FailureDetails: View {
    var text: String
    @State private var open = false
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button { Haptic.play(); withAnimation(.easeOut(duration: 0.2)) { open.toggle() } } label: {
                Text(open ? String(localized: "hide details") : String(localized: "details"))
                    .font(Theme.mono(13, .medium)).foregroundStyle(Theme.muted).frame(minHeight: 44)
            }
            .accessibilityIdentifier("failureDetailsButton")
            if open {
                Text(text).font(Theme.mono(12)).foregroundStyle(Theme.ink).textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                PhoneButton(label: copied ? String(localized: "copied") : String(localized: "copy details"),
                            compact: true, identifier: "copyDetailsButton") {
                    UIPasteboard.general.string = text
                    copied = true
                }
            }
        }
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
                            Button { Haptic.play(); model.use(c); close() } label: {
                                HStack {
                                    Text(c.display).font(Theme.mono(14, .medium)).foregroundStyle(Theme.ink).lineLimit(1)
                                    Spacer()
                                    if c == model.current { Text("open").font(Theme.mono(12)).foregroundStyle(Theme.accent) }
                                }
                                .padding(.horizontal, 14).frame(minHeight: 48)
                            }
                            .buttonStyle(.pressable)
                            Button { Haptic.play("medium"); model.forget(c) } label: { TileLabel(text: String(localized: "forget"), tint: Theme.error) }
                                .buttonStyle(.pressable)
                                .padding(.trailing, 8)
                        }
                        .tile()
                    }
                    Button { Haptic.play(); adding = true } label: { TileLabel(text: String(localized: "+ pair another computer")) }
                        .buttonStyle(.pressable)
                        .accessibilityIdentifier("pairAnotherButton")
                    Hint(text: String(localized: "Hold two fingers on the page to come back here."))
                }
                .padding(20)
            }
            .background(Theme.paper.ignoresSafeArea())
            .navigationDestination(isPresented: $adding) { ShellPairingView(model: model, onDone: { adding = false; close() }) }
            .toolbar(.hidden, for: .navigationBar)
        }
    }
}

/// Scan the QR code the computer shows, or paste the link it prints.
struct ShellPairingView: View {
    var model: ShellModel
    var onDone: (() -> Void)?
    /// First launch only: the way in without a computer.
    var onDemo: (() -> Void)?
    @State private var text = ""
    @State private var error: String?
    @State private var scanning = false

    private static let privacyPolicy = URL(string: "https://rove.run/privacy")!

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
                    // Shown without a camera too: the scanner says why it can't scan.
                    PhoneButton(label: String(localized: "scan qr code"), systemImage: "qrcode.viewfinder",
                                identifier: "scanButton") { scanning = true }
                    FormSection(label: String(localized: "or paste the link")) {
                        FieldBox {
                            TextField("", text: $text, prompt: Text(verbatim: "http://host:7878/#token=…").foregroundStyle(Theme.muted), axis: .vertical)
                                .keyboardType(.URL)
                                .lineLimit(1...4)
                                .accessibilityIdentifier("pairingField")
                        }
                    }
                }
                .padding(.horizontal, 20).padding(.top, 20).padding(.bottom, 24)
            }
            .scrollDismissesKeyboard(.interactively)
            VStack(alignment: .leading, spacing: 8) {
                if let error { ErrorLine(text: error).accessibilityIdentifier("pairingError") }
                PhoneButton(label: String(localized: "connect"), primary: true,
                            enabled: !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                            identifier: "connectButton") { pair(text) }
                if let onDemo {
                    PhoneButton(label: String(localized: "try a demo"), identifier: "demoButton") { onDemo() }
                }
                Link(destination: Self.privacyPolicy) {
                    Text("privacy policy").font(Theme.mono(13)).foregroundStyle(Theme.muted)
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .accessibilityIdentifier("privacyPolicyLink")
            }
            .padding(.horizontal, 16).padding(.vertical, 8)
        }
        .background(Theme.paper.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .sheet(isPresented: $scanning) {
            // Not `quillSheetChrome()`: that reads the native app's `AppModel`, which the shell doesn't have.
            QRScannerView { code in scanning = false; text = code; pair(code) }
                .presentationBackground(Theme.paper)
        }
    }

    private func pair(_ link: String) {
        do {
            try model.pair(link)
            Haptic.play("success")
            error = nil
            text = ""
            onDone?()
        } catch {
            Haptic.play("warning")
            self.error = error.localizedDescription
        }
    }
}
