import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// Reply mode: compose text, return sends it followed by Enter. A message with line breaks goes in as one
/// bracketed paste, so the engine does not submit at the first newline.
struct Composer: View {
    var session: TerminalSession
    var engineName: String?
    @State private var text = ""
    @State private var showPhotos = false
    @State private var showFiles = false
    @State private var photo: PhotosPickerItem?
    @State private var uploading = false
    @State private var error: String?

    private static let fileTypes: [UTType] = [.png, .jpeg, .gif, .webP, .pdf]

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let error {
                Text(error).font(Theme.mono(12)).foregroundStyle(Theme.error)
                    .lineLimit(2).padding(.horizontal, 14)
                    .accessibilityIdentifier("attachError")
            }
            HStack(spacing: 8) {
                attachMenu
                FieldBox {
                    TextField("", text: $text, prompt: Text(placeholder).foregroundStyle(Theme.muted), axis: .vertical)
                        .lineLimit(1...5)
                        .submitLabel(.send)
                        .onSubmit(send)
                        .accessibilityIdentifier("composerField")
                }
                Button { text += "\n" } label: {
                    Text("↵").font(Theme.mono(16, .medium)).foregroundStyle(Theme.muted)
                        .frame(width: 34, height: 44)
                }
                .buttonStyle(.pressable)
                .accessibilityLabel("New line")
                .accessibilityIdentifier("newlineButton")
                Button(action: send) {
                    Text("send")
                        .font(Theme.mono(14, .semibold))
                        .foregroundStyle(text.isEmpty ? Theme.muted : Theme.paper)
                        .padding(.horizontal, 14)
                        .frame(height: 44)
                        .background(text.isEmpty ? Theme.inset : Theme.accent,
                                    in: RoundedRectangle(cornerRadius: Theme.radius, style: .continuous))
                }
                .buttonStyle(.pressable)
                .disabled(text.isEmpty)
                .accessibilityIdentifier("sendButton")
            }
            .padding(.horizontal, 12)
        }
        .padding(.top, 6)
        .padding(.bottom, 8)
        .background(Theme.paper)
        .photosPicker(isPresented: $showPhotos, selection: $photo, matching: .images)
        .fileImporter(isPresented: $showFiles, allowedContentTypes: Self.fileTypes) { result in
            if case .success(let url) = result { load { try Self.read(url) } }
        }
        .onChange(of: photo) {
            guard let item = photo else { return }
            photo = nil
            load { try await item.loadTransferable(type: Data.self) ?? { throw AttachmentLogic.PrepareError.unsupported }() }
        }
    }

    private var attachMenu: some View {
        Menu {
            Button { showPhotos = true } label: { Label("Photo", systemImage: "photo") }
            Button { showFiles = true } label: { Label("File (image or pdf)", systemImage: "doc") }
        } label: {
            Group {
                if uploading { BrailleSpinner(size: 13) } else { Text("+").font(Theme.mono(20, .medium)).foregroundStyle(Theme.accent) }
            }
            .frame(width: 34, height: 44)
        }
        .disabled(uploading)
        .accessibilityLabel("Attach")
        .accessibilityIdentifier("attachButton")
    }

    private var placeholder: String {
        engineName.map { String(localized: "reply to \($0.lowercased())") } ?? String(localized: "reply")
    }

    private func send() {
        guard !text.isEmpty else { return }
        session.reply(text)
        text = ""
        error = nil
    }

    private static func read(_ url: URL) throws -> Data {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        return try Data(contentsOf: url)
    }

    /// Reads, checks, uploads, then pastes the path into the engine's input (not submitted).
    private func load(_ read: @escaping () async throws -> Data) {
        uploading = true
        error = nil
        Task {
            defer { uploading = false }
            do {
                try await session.attach(AttachmentLogic.prepare(try await read()))
            } catch { self.error = error.localizedDescription }
        }
    }
}
