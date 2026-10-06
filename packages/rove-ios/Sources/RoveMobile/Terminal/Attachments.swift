import Foundation
import UIKit

/// What `attachment.put` accepts and how its reference is spelled for an engine — the same
/// `images[0]: /path` / `pdf[1]: /path` lines the TUI composer appends (`tui/lib/attachments.ts`).
enum AttachmentLogic {
    /// Mirrors the bridge's raw cap (the frame limit is 8 MiB once base64-encoded).
    static let maxBytes = 5 * 1024 * 1024

    /// Chip / prompt-line label: `images[n]` for images, `pdf[n]` for PDFs.
    static func label(path: String, index: Int) -> String {
        path.lowercased().hasSuffix(".pdf") ? "pdf[\(index)]" : "images[\(index)]"
    }

    /// One reference line, as `appendAttachmentRefs` writes it.
    static func ref(path: String, index: Int) -> String { "\(label(path: path, index: index)): \(path)" }

    /// The declared type by magic number — a file's name is not evidence.
    static func sniff(_ data: Data) -> String? {
        let b = [UInt8](data.prefix(12))
        if b.starts(with: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) { return "image/png" }
        if b.starts(with: [0xFF, 0xD8, 0xFF]) { return "image/jpeg" }
        if b.starts(with: [0x47, 0x49, 0x46, 0x38]) { return "image/gif" }
        if b.count >= 12, b.starts(with: [0x52, 0x49, 0x46, 0x46]), Array(b[8..<12]) == [0x57, 0x45, 0x42, 0x50] { return "image/webp" }
        if b.starts(with: [0x25, 0x50, 0x44, 0x46]) { return "application/pdf" }
        return nil
    }

    struct Prepared: Equatable {
        var mime: String
        var data: Data
    }

    enum PrepareError: LocalizedError, Equatable {
        case unsupported, tooLarge
        var errorDescription: String? {
            switch self {
            case .unsupported: "only png, jpeg, gif, webp and pdf can be attached"
            case .tooLarge: "that file is over 5 MB"
            }
        }
    }

    /// Picker bytes → something the bridge takes. Photos often arrive as HEIC, which engines cannot read,
    /// so an undecodable-by-engine image is re-encoded as JPEG, scaled down until it fits.
    static func prepare(_ data: Data) throws -> Prepared {
        if let mime = sniff(data) {
            guard data.count <= maxBytes else {
                // Only images can be shrunk; a PDF over the cap is refused.
                if mime != "application/pdf", let jpeg = shrunkJPEG(data) { return Prepared(mime: "image/jpeg", data: jpeg) }
                throw PrepareError.tooLarge
            }
            return Prepared(mime: mime, data: data)
        }
        guard let jpeg = shrunkJPEG(data) else { throw PrepareError.unsupported }
        return Prepared(mime: "image/jpeg", data: jpeg)
    }

    private static func shrunkJPEG(_ data: Data) -> Data? {
        guard let image = UIImage(data: data) else { return nil }
        var scale: CGFloat = 1
        while scale > 0.1 {
            let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
            let format = UIGraphicsImageRendererFormat()
            format.scale = 1
            let out = UIGraphicsImageRenderer(size: size, format: format).jpegData(withCompressionQuality: 0.85) {
                _ in image.draw(in: CGRect(origin: .zero, size: size))
            }
            if out.count <= maxBytes { return out }
            scale *= 0.7
        }
        return nil
    }
}

struct AttachmentPutResult: Codable, Equatable {
    var path: String
    var kind: String
    var bytes: Int
}

extension TerminalSession {
    /// Upload, then paste `images[n]: /abs/path` into the engine's input WITHOUT submitting, so the
    /// user can add words around it.
    func attach(_ prepared: AttachmentLogic.Prepared) async throws {
        let args: [String: Any] = ["mime": prepared.mime, "data": prepared.data.base64EncodedString()]
        let result = try await client.request("attachment.put", args, as: AttachmentPutResult.self)
        paste(AttachmentLogic.ref(path: result.path, index: attachmentCount))
        attachmentCount += 1
    }

    /// `rove api interrupt` for this tab: stop the running turn, keep the conversation.
    func interrupt() async {
        do {
            _ = try await client.request("tab.interrupt", ["taskId": taskId, "tabId": tabId], as: EmptyResult.self)
            flash("interrupt sent")
        } catch { flash(error.localizedDescription) }
    }
}
