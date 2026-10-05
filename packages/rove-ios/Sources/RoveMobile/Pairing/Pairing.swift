import Foundation
import Security

struct Pairing: Equatable {
    /// Full WebSocket URL including the `token` query item.
    var url: URL
    var token: String

    var host: String { url.host ?? "" }
    var display: String { "\(host)\(url.port.map { ":\($0)" } ?? "")" }
}

enum PairingError: Error, Equatable, LocalizedError {
    case empty, invalidURL, unsupportedScheme, missingToken

    var errorDescription: String? {
        switch self {
        case .empty: "Paste a pairing URL first."
        case .invalidURL: "That doesn't look like a valid pairing URL."
        case .unsupportedScheme: "Pairing URLs must start with ws:// or rove://pair."
        case .missingToken: "The pairing URL has no token."
        }
    }
}

enum PairingParser {
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
        guard let comps = URLComponents(string: text), let scheme = comps.scheme?.lowercased() else {
            throw PairingError.invalidURL
        }
        guard scheme == "ws" || scheme == "wss" else { throw PairingError.unsupportedScheme }
        guard let host = comps.host, !host.isEmpty else { throw PairingError.invalidURL }
        guard let token = comps.queryItems?.first(where: { $0.name == "token" })?.value, !token.isEmpty else {
            throw PairingError.missingToken
        }
        guard let url = comps.url else { throw PairingError.invalidURL }
        return Pairing(url: url, token: token)
    }
}

/// Stores the pairing URL (which embeds the token) as one Keychain item.
struct KeychainStore {
    var service = "run.rove.mobile"
    var account = "pairing"

    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
         kSecAttrAccount as String: account]
    }

    func save(_ pairing: Pairing) {
        delete()
        var q = query
        q[kSecValueData as String] = Data(pairing.url.absoluteString.utf8)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(q as CFDictionary, nil)
    }

    func load() -> Pairing? {
        var q = query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess,
              let data = out as? Data, let s = String(data: data, encoding: .utf8) else { return nil }
        return try? PairingParser.parse(s)
    }

    func delete() { SecItemDelete(query as CFDictionary) }
}
