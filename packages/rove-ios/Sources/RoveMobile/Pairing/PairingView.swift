import SwiftUI
import AVFoundation

struct PairingView: View {
    var isOnboarding = false
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var error: String?
    @State private var scanning = false

    private var cameraAvailable: Bool { AVCaptureDevice.default(for: .video) != nil }

    var body: some View {
        Form {
            Section("Connection") {
                LabeledContent("Status", value: model.client.state.label)
                if let p = model.pairing { LabeledContent("Bridge", value: p.display) }
                if let h = model.client.hello { LabeledContent("Host", value: h.host) }
            }
            Section {
                TextField("ws://host:port/?token=…", text: $text, axis: .vertical)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .lineLimit(1...4)
                    .font(.footnote.monospaced())
                    .accessibilityIdentifier("pairingField")
                Button("Paste from clipboard") { text = UIPasteboard.general.string ?? text }
                if cameraAvailable {
                    Button("Scan QR code") { scanning = true }
                }
                Button("Connect") { connect(text) }
                    .accessibilityIdentifier("connectButton")
                    .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                if let error { Text(error).foregroundStyle(.red).font(.footnote) }
            } header: {
                Text(model.pairing == nil ? "Pair with your Mac" : "Pair again")
            } footer: {
                if !cameraAvailable { Text("No camera available — paste the pairing URL instead.") }
            }
            if model.pairing != nil {
                Section {
                    if model.client.state == .disconnected {
                        Button("Connect") { model.reconnect() }
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
        .sheet(isPresented: $scanning) {
            QRScannerView { code in
                scanning = false
                text = code
                connect(code)
            }
            .ignoresSafeArea()
        }
    }

    private func connect(_ s: String) {
        do { try model.pair(text: s); error = nil; text = "" }
        catch { self.error = error.localizedDescription }
    }
}
