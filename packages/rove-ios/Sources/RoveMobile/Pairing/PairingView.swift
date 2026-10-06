import SwiftUI
import AVFoundation

struct HeaderRow: Identifiable, Equatable {
    let id = UUID()
    var name = ""
    var value = ""
}

struct PairingView: View {
    var isOnboarding = false
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var preset: PairingPreset = .direct
    @State private var cfId = ""
    @State private var cfSecret = ""
    @State private var headers: [HeaderRow] = []
    @State private var error: String?
    @State private var scanning = false

    private var cameraAvailable: Bool { AVCaptureDevice.default(for: .video) != nil }
    private var urlEmpty: Bool { text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    private var cfReady: Bool {
        preset != .cloudflare || (!cfId.trimmingCharacters(in: .whitespaces).isEmpty
            && !cfSecret.trimmingCharacters(in: .whitespaces).isEmpty)
    }

    var body: some View {
        VStack(spacing: 0) {
            ScreenHeader {
                BracketChip(size: 19).accessibilityAddTraits(.isHeader)
            } trailing: {
                if !isOnboarding {
                    Button { dismiss() } label: {
                        Text("done").font(Theme.mono(14, .semibold)).foregroundStyle(Theme.accent)
                            .frame(minWidth: 44, minHeight: 36)
                    }
                    .buttonStyle(.pressable)
                    .accessibilityIdentifier("doneButton")
                }
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    intro
                    if model.pairing != nil { connectionCard }
                    networkSection
                    linkSection
                    if preset == .cloudflare { cloudflareSection }
                    headersSection
                    if model.pairing != nil { sessionActions }
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)
                .padding(.bottom, 24)
            }
            .scrollDismissesKeyboard(.interactively)
            connectBar
        }
        .background(Theme.paper.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .keyboardDoneButton()
        .onAppear {
            if let draft = model.draftURL { text = draft; model.draftURL = nil; applyPresetFromText() }
        }
        .sheet(isPresented: $scanning) {
            QRScannerView { code in
                scanning = false
                text = code
                if cfReady { connect() }
            }
            .ignoresSafeArea()
        }
    }

    private var intro: some View {
        VStack(alignment: .leading, spacing: 8) {
            Theme.kicker(model.pairing == nil ? "pair · remote control" : "settings · bridge")
            Text(model.pairing == nil ? "drive your mac's tasks from here" : "this phone's bridge")
                .font(Theme.face(24, .semibold))
                .foregroundStyle(Theme.ink)
            // Prose, so the system face; ink, because this line is the instructions.
            Text("Start rove-bridge on your Mac, then scan the QR code it shows or paste the link it prints.")
                .font(Theme.face(16))
                .foregroundStyle(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var connectionCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Theme.kicker("connection")
            VStack(spacing: 0) {
                infoRow("status", model.client.state.label.lowercased(),
                        tone: { if case .failed = model.client.state { return Theme.error }; return Theme.ink }())
                if let p = model.pairing { divider; infoRow("bridge", p.display) }
                if let h = model.client.hello { divider; infoRow("host", h.host); divider; infoRow("rove", h.roveVersion) }
            }
            .tile()
        }
    }

    private var divider: some View { Rectangle().fill(Theme.line).frame(height: 1).padding(.leading, 14) }

    private func infoRow(_ label: String, _ value: String, tone: Color = Theme.ink) -> some View {
        HStack {
            Text(label).font(Theme.mono(13)).foregroundStyle(Theme.muted)
            Spacer()
            Text(value).font(Theme.mono(13, .medium)).foregroundStyle(tone).lineLimit(1).truncationMode(.middle)
        }
        .padding(.horizontal, 14)
        .frame(minHeight: 44)
    }

    private var networkSection: some View {
        FormSection(label: "network") {
            ChoiceTiles(options: PairingPreset.allCases, selection: $preset) { $0.title.lowercased() }
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("presetPicker")
        }
    }

    private var linkSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Theme.kicker(model.pairing == nil ? "pairing link" : "pair again")
            FieldBox {
                TextField("", text: $text, prompt: Text("ws://host:7878/?token=…").foregroundStyle(Theme.muted), axis: .vertical)
                    .keyboardType(.URL)
                    .lineLimit(1...4)
                    .accessibilityIdentifier("pairingField")
                    .onChange(of: text) { applyPresetFromText() }
            }
            HStack(spacing: 6) {
                Button { text = UIPasteboard.general.string ?? text } label: { TileLabel(text: "paste") }
                    .buttonStyle(.pressable)
                if cameraAvailable {
                    Button { scanning = true } label: { TileLabel(text: "scan qr") }
                        .buttonStyle(.pressable)
                }
                Spacer()
            }
            if !cameraAvailable { Hint(text: "no camera here — paste the link instead") }
        }
    }

    private var cloudflareSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Theme.kicker("cloudflare access")
            FieldBox {
                TextField("", text: $cfId, prompt: Text("CF-Access-Client-Id").foregroundStyle(Theme.muted))
                    .accessibilityIdentifier("cfClientId")
            }
            FieldBox {
                SecureField("", text: $cfSecret, prompt: Text("CF-Access-Client-Secret").foregroundStyle(Theme.muted))
                    .accessibilityIdentifier("cfClientSecret")
            }
            Hint(text: "service token from zero trust → access → service auth")
        }
    }

    private var headersSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Theme.kicker("extra headers")
            ForEach($headers) { $row in
                HStack(spacing: 6) {
                    FieldBox { TextField("", text: $row.name, prompt: Text("name").foregroundStyle(Theme.muted)) }
                    FieldBox { SecureField("", text: $row.value, prompt: Text("value").foregroundStyle(Theme.muted)) }
                    Button { headers.removeAll { $0.id == row.id } } label: {
                        Text("×").font(Theme.mono(16)).foregroundStyle(Theme.muted).frame(width: 32, height: 40)
                    }
                    .buttonStyle(.pressable)
                    .accessibilityLabel("Remove header")
                }
            }
            HStack {
                Button { headers.append(HeaderRow()) } label: { TileLabel(text: "+ header") }
                    .buttonStyle(.pressable)
                Spacer()
            }
            Hint(text: "sent with the websocket upgrade · the app owns authorization")
        }
    }

    private var sessionActions: some View {
        HStack(spacing: 6) {
            if model.client.state == .disconnected {
                Button { model.reconnect() } label: { TileLabel(text: "reconnect") }.buttonStyle(.pressable)
            } else {
                Button { model.disconnect() } label: { TileLabel(text: "disconnect") }.buttonStyle(.pressable)
            }
            Spacer()
            Button { model.forget() } label: { TileLabel(text: "forget pairing", tint: Theme.error) }
                .buttonStyle(.pressable)
        }
    }

    /// Full-width primary bar; the error line sits right above it so it can't scroll away.
    private var connectBar: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let error { ErrorLine(text: error).accessibilityIdentifier("pairingError") }
            PrimaryBar(label: "connect", enabled: !urlEmpty && cfReady) { connect() }
                .accessibilityIdentifier("connectButton")
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(Theme.paper)
    }

    /// A URL carrying `preset=` selects that preset in the picker.
    private func applyPresetFromText() {
        if let p = try? PairingParser.parse(text) { preset = p.preset }
    }

    private func connect() {
        do {
            var p = try PairingParser.parse(text)
            p.preset = preset
            if preset == .cloudflare { p.cfAccessClientId = cfId; p.cfAccessClientSecret = cfSecret }
            for h in headers where !h.name.trimmingCharacters(in: .whitespaces).isEmpty {
                p.customHeaders[h.name.trimmingCharacters(in: .whitespaces)] = h.value
            }
            try model.connect(p)
            error = nil
            text = ""; cfId = ""; cfSecret = ""; headers = []
        } catch { self.error = error.localizedDescription }
    }
}
