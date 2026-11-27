import Foundation

/// One paired computer: the rove-web page the shell loads. `url` carries the credential in its fragment
/// (`#token=…`, or the relay's `#code=…&token=…`), which WebKit never sends to a server; rove-web moves it into
/// its own storage and off the address bar. It is a password: it lives in the Keychain only.
struct ShellComputer: Codable, Equatable, Identifiable {
    var url: URL
    var id: String { origin }
    /// What the list shows: host and port, never the fragment.
    var origin: String { "\(url.scheme ?? "")://\(url.host ?? "")\(url.port.map { ":\($0)" } ?? "")" }
    var display: String { "\(url.host ?? "")\(url.port.map { ":\($0)" } ?? "")" }
}

/// Turns any link the bridge prints into the rove-web page to load:
/// - `http(s)://host[:port]/#token=…` — `rove --web`'s `open:` link (a bare one, no token, signs in in the page).
/// - `https://<relay>/#code=…&token=…` — `--preset relay`; loaded as is, the relay loader needs both.
/// - `ws(s)://host[:port]/?token=…[&preset=…]` — the `pair:` link / phone QR; same host, page served over http(s).
/// - `rove://pair?url=<encoded any of the above>`.
enum ShellLink {
    static func parse(_ input: String) throws -> ShellComputer {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { throw PairingError.empty }
        guard var comps = URLComponents(string: text), let scheme = comps.scheme?.lowercased() else {
            throw PairingError.invalidURL
        }
        if scheme == "rove" {
            guard comps.host?.lowercased() == "pair",
                  let inner = comps.queryItems?.first(where: { $0.name == "url" })?.value,
                  URLComponents(string: inner)?.scheme?.lowercased() != "rove" else { throw PairingError.invalidURL }
            return try parse(inner)
        }
        guard let host = comps.host, !host.isEmpty else { throw PairingError.invalidURL }
        switch scheme {
        case "http", "https":
            break
        case "ws", "wss":
            let items = comps.queryItems ?? []
            guard let token = items.first(where: { $0.name == "token" })?.value, !token.isEmpty else {
                throw PairingError.missingToken
            }
            if let preset = items.first(where: { $0.name == "preset" })?.value,
               !["none", "tailscale", "cf", "relay"].contains(preset.lowercased()) {
                throw PairingError.unknownPreset
            }
            comps.scheme = scheme == "wss" ? "https" : "http"
            comps.path = "/"
            comps.queryItems = nil
            comps.fragment = "token=\(token)"
        default:
            throw PairingError.unsupportedScheme
        }
        guard let url = comps.url else { throw PairingError.invalidURL }
        return ShellComputer(url: url)
    }
}
