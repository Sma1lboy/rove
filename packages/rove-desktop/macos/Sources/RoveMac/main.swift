import AppKit
import WebKit

// Only a bridge opened by the person launching this preview can host terminal views.
guard let raw = ProcessInfo.processInfo.environment["ROVE_DESKTOP_URL"],
      let address = URL(string: raw), ["localhost", "127.0.0.1", "::1", "[::1]"].contains(address.host ?? ""),
      ["http", "https"].contains(address.scheme ?? "") else {
    fputs("Set ROVE_DESKTOP_URL to the local pairing URL printed by rove --web.\n", stderr)
    exit(2)
}

let app = NSApplication.shared
let workspace = Workspace(address: address)
app.delegate = workspace
app.setActivationPolicy(.regular)
app.run()
