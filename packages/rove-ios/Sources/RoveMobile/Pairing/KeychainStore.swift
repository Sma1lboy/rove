import Foundation
import Security

/// Stores the whole pairing (endpoint, token, preset, headers) as one JSON blob in one Keychain item.
struct KeychainStore {
    var service = "run.rove.mobile"
    var account = "pairing"

    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
         kSecAttrAccount as String: account]
    }

    static func encode(_ p: Pairing) -> Data? { try? JSONEncoder().encode(p) }
    static func decode(_ d: Data) -> Pairing? { try? JSONDecoder().decode(Pairing.self, from: d) }

    @discardableResult
    func save(_ pairing: Pairing) -> Bool {
        guard let data = Self.encode(pairing) else { return false }
        delete()
        var q = query
        q[kSecValueData as String] = data
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        return SecItemAdd(q as CFDictionary, nil) == errSecSuccess
    }

    func load() -> Pairing? {
        var q = query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return Self.decode(data)
    }

    func delete() { SecItemDelete(query as CFDictionary) }
}
