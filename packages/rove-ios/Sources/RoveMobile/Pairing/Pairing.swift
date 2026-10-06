import Foundation

enum PairingPreset: String, Codable, CaseIterable, Identifiable {
    case direct = "none"
    case tailscale
    case cloudflare

    var id: String { rawValue }

    var title: String {
        switch self {
        case .direct: String(localized: "Direct")
        case .tailscale: "Tailscale"
        case .cloudflare: "Cloudflare"
        }
    }

    /// Value of the `preset=` query item in pairing URLs.
    init?(queryValue: String) {
        switch queryValue.lowercased() {
        case "none": self = .direct
        case "tailscale": self = .tailscale
        case "cf": self = .cloudflare
        default: return nil
        }
    }
}

/// Everything needed to open the bridge socket. The token and header values are secrets:
/// they live only in the Keychain and in request headers, never in a URL, log, or error text.
struct Pairing: Equatable, Codable {
    /// Socket URL without `token` / `preset` query items.
    var endpoint: URL
    var token: String
    var preset: PairingPreset = .direct
    var customHeaders: [String: String] = [:]
    /// Cloudflare Access service token (only used with the Cloudflare preset).
    var cfAccessClientId = ""
    var cfAccessClientSecret = ""

    var display: String { "\(endpoint.host ?? "")\(endpoint.port.map { ":\($0)" } ?? "")" }

    /// Endpoint rules that don't depend on credentials.
    func validateEndpoint() throws {
        if preset == .cloudflare, endpoint.scheme?.lowercased() != "wss" { throw PairingError.cloudflareNeedsTLS }
    }

    /// Full check before connecting.
    func validate() throws {
        try validateEndpoint()
        if preset == .cloudflare,
           cfAccessClientId.trimmingCharacters(in: .whitespaces).isEmpty
            || cfAccessClientSecret.trimmingCharacters(in: .whitespaces).isEmpty {
            throw PairingError.missingAccessCredentials
        }
    }

    var isComplete: Bool { (try? validate()) != nil }
}

enum PairingError: Error, Equatable, LocalizedError {
    case empty, invalidURL, unsupportedScheme, missingToken, unknownPreset, cloudflareNeedsTLS, missingAccessCredentials

    var errorDescription: String? {
        switch self {
        case .empty: String(localized: "Paste a pairing URL first.")
        case .invalidURL: String(localized: "That doesn't look like a valid pairing URL.")
        case .unsupportedScheme: String(localized: "Pairing URLs must start with ws://, wss:// or rove://pair.")
        case .missingToken: String(localized: "The pairing URL has no token.")
        case .unknownPreset: String(localized: "The pairing URL has an unknown preset.")
        case .cloudflareNeedsTLS: String(localized: "The Cloudflare preset needs a wss:// URL.")
        case .missingAccessCredentials: String(localized: "Enter the Cloudflare Access client id and secret.")
        }
    }
}

enum PairingParser {
    /// Parses ws/wss pairing URLs and `rove://pair?url=<encoded>` links. Strips `token` and `preset`.
    static func parse(_ input: String) throws -> Pairing {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { throw PairingError.empty }
        guard let comps = URLComponents(string: text), let scheme = comps.scheme?.lowercased() else {
            throw PairingError.invalidURL
        }
        switch scheme {
        case "rove":
            guard comps.host?.lowercased() == "pair",
                  let inner = comps.queryItems?.first(where: { $0.name == "url" })?.value else {
                throw PairingError.invalidURL
            }
            return try parseSocketURL(inner.trimmingCharacters(in: .whitespacesAndNewlines))
        case "ws", "wss":
            return try parseSocketURL(text)
        default:
            throw PairingError.unsupportedScheme
        }
    }

    private static func parseSocketURL(_ text: String) throws -> Pairing {
        guard var comps = URLComponents(string: text), let scheme = comps.scheme?.lowercased() else {
            throw PairingError.invalidURL
        }
        guard scheme == "ws" || scheme == "wss" else { throw PairingError.unsupportedScheme }
        guard let host = comps.host, !host.isEmpty else { throw PairingError.invalidURL }
        let items = comps.queryItems ?? []
        guard let token = items.first(where: { $0.name == "token" })?.value, !token.isEmpty else {
            throw PairingError.missingToken
        }
        var preset = PairingPreset.direct
        if let raw = items.first(where: { $0.name == "preset" }) {
            guard let p = PairingPreset(queryValue: raw.value ?? "") else { throw PairingError.unknownPreset }
            preset = p
        }
        let rest = items.filter { $0.name != "token" && $0.name != "preset" }
        comps.queryItems = rest.isEmpty ? nil : rest
        guard let endpoint = comps.url else { throw PairingError.invalidURL }
        let pairing = Pairing(endpoint: endpoint, token: token, preset: preset)
        try pairing.validateEndpoint()
        return pairing
    }
}
