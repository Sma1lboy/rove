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
        Form {
            Section("Connection") {
                LabeledContent("Status", value: model.client.state.label)
                if let p = model.pairing { LabeledContent("Bridge", value: p.display) }
                if let h = model.client.hello { LabeledContent("Host", value: h.host) }
            }
            Section {
                Picker("Network", selection: $preset) {
                    ForEach(PairingPreset.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("presetPicker")
                TextField("ws://host:port/?token=…", text: $text, axis: .vertical)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .lineLimit(1...4)
                    .font(.footnote.monospaced())
                    .accessibilityIdentifier("pairingField")
                    .onChange(of: text) { applyPresetFromText() }
                Button("Paste from clipboard") { text = UIPasteboard.general.string ?? text }
                if cameraAvailable {
                    Button("Scan QR code") { scanning = true }
                }
            } header: {
                Text(model.pairing == nil ? "Pair with your Mac" : "Pair again")
            } footer: {
                if !cameraAvailable { Text("No camera available — paste the pairing URL instead.") }
            }
            if preset == .cloudflare {
                Section {
                    TextField("CF-Access-Client-Id", text: $cfId)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .accessibilityIdentifier("cfClientId")
                    SecureField("CF-Access-Client-Secret", text: $cfSecret)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .accessibilityIdentifier("cfClientSecret")
                } header: {
                    Text("Cloudflare Access")
                } footer: {
                    Text("Service token from Cloudflare Zero Trust → Access → Service Auth")
                }
            }
            Section {
                ForEach($headers) { $row in
                    VStack(alignment: .leading) {
                        TextField("Header name", text: $row.name)
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                        SecureField("Value", text: $row.value)
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                    }
                }
                .onDelete { headers.remove(atOffsets: $0) }
                Button { headers.append(HeaderRow()) } label: { Label("Add header", systemImage: "plus") }
            } header: {
                Text("Additional headers")
            } footer: {
                Text("Sent with the WebSocket upgrade. Authorization is set by the app and can't be overridden.")
            }
            Section {
                Button("Connect") { connect() }
                    .accessibilityIdentifier("connectButton")
                    .disabled(urlEmpty || !cfReady)
                if let error { Text(error).foregroundStyle(.red).font(.footnote) }
            }
            if model.pairing != nil {
                Section {
                    if model.client.state == .disconnected {
                        Button("Reconnect") { model.reconnect() }
                    } else {
                        Button("Disconnect") { model.disconnect() }
                    }
                    Button("Forget pairing", role: .destructive) { model.forget() }
                }
            }
        }
        .keyboardDoneButton()
        .navigationTitle(isOnboarding ? "Pair Rove" : "Settings")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if !isOnboarding { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
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
