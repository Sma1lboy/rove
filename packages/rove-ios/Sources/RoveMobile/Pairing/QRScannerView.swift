import SwiftUI
import AVFoundation

/// The camera, reading the pairing QR code; a message in its place when there is no camera or no access to it.
struct QRScannerView: View {
    var onCode: (String) -> Void
    @State private var problem = Self.blocked
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    enum Problem { case denied, noCamera }

    /// Known before the camera view is made, so the sheet opens on the message instead of a black preview.
    private static var blocked: Problem? {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .denied, .restricted: return .denied
        default: return AVCaptureDevice.default(for: .video) == nil ? .noCamera : nil
        }
    }

    var body: some View {
        if let problem {
            VStack(alignment: .leading, spacing: 12) {
                Theme.kicker(String(localized: "scan qr code"))
                Text(problem == .denied
                     ? String(localized: "Rove can't use the camera. Allow it in Settings, or paste the link instead.")
                     : String(localized: "no camera here — paste the link instead"))
                    .font(Theme.face(16)).foregroundStyle(Theme.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("scannerProblem")
                Spacer()
                if problem == .denied, let settings = URL(string: UIApplication.openSettingsURLString) {
                    PhoneButton(label: String(localized: "open settings"), primary: true, identifier: "scannerSettings") {
                        openURL(settings)
                    }
                }
                PhoneButton(label: String(localized: "close"), identifier: "scannerClose") { dismiss() }
            }
            .padding(20)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(Theme.paper.ignoresSafeArea())
        } else {
            Camera(onCode: onCode, onProblem: { problem = $0 }).ignoresSafeArea()
        }
    }

    private struct Camera: UIViewControllerRepresentable {
        var onCode: (String) -> Void
        var onProblem: (Problem) -> Void

        func makeUIViewController(context: Context) -> ScannerController {
            let vc = ScannerController()
            vc.onCode = onCode
            vc.onProblem = onProblem
            return vc
        }

        func updateUIViewController(_ vc: ScannerController, context: Context) {}
    }

    final class ScannerController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
        var onCode: ((String) -> Void)?
        var onProblem: ((Problem) -> Void)?
        private let session = AVCaptureSession()
        /// AVCaptureSession's start and stop block; they run here, off the main thread, touching only the session.
        private let queue = DispatchQueue(label: "run.rove.scanner")
        private var preview: AVCaptureVideoPreviewLayer?
        private var done = false

        override func viewDidLoad() {
            super.viewDidLoad()
            view.backgroundColor = Theme.cameraBackdropUI
            switch AVCaptureDevice.authorizationStatus(for: .video) {
            case .authorized: configure()
            case .notDetermined:
                // The reply comes on a background queue: the closure is nonisolated and hops to the main actor itself.
                AVCaptureDevice.requestAccess(for: .video) { @Sendable granted in
                    Task { @MainActor [weak self] in
                        if granted { self?.configure() } else { self?.report(.denied) }
                    }
                }
            default: report(.denied)
            }
        }

        /// Never from inside SwiftUI's own update (`viewDidLoad` runs in `makeUIViewController`).
        private func report(_ problem: Problem) {
            Task { @MainActor [weak self] in self?.onProblem?(problem) }
        }

        private func configure() {
            guard let device = AVCaptureDevice.default(for: .video),
                  let input = try? AVCaptureDeviceInput(device: device),
                  session.canAddInput(input) else { return report(.noCamera) }
            session.addInput(input)
            let output = AVCaptureMetadataOutput()
            guard session.canAddOutput(output) else { return report(.noCamera) }
            session.addOutput(output)
            output.setMetadataObjectsDelegate(self, queue: .main)
            output.metadataObjectTypes = [.qr]
            let layer = AVCaptureVideoPreviewLayer(session: session)
            layer.videoGravity = .resizeAspectFill
            layer.frame = view.bounds
            view.layer.addSublayer(layer)
            preview = layer
            let session = session
            queue.async { session.startRunning() }
        }

        override func viewDidLayoutSubviews() {
            super.viewDidLayoutSubviews()
            preview?.frame = view.bounds
        }

        override func viewWillDisappear(_ animated: Bool) {
            super.viewWillDisappear(animated)
            let session = session
            queue.async { if session.isRunning { session.stopRunning() } }
        }

        /// Delivered on the main queue (`setMetadataObjectsDelegate(_:queue: .main)`).
        nonisolated func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput objects: [AVMetadataObject],
                                        from connection: AVCaptureConnection) {
            guard let code = (objects.first as? AVMetadataMachineReadableCodeObject)?.stringValue else { return }
            MainActor.assumeIsolated {
                guard !done else { return }
                done = true
                onCode?(code)
            }
        }
    }
}
