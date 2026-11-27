import Foundation
import Security

/// One JSON blob in one Keychain item: the native app's pairing, or the web shell's computers (`account`).
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
        return saveData(data)
    }

    func load() -> Pairing? { loadData().flatMap(Self.decode) }

    @discardableResult
    func saveData(_ data: Data) -> Bool {
        delete()
        var q = query
        q[kSecValueData as String] = data
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        return SecItemAdd(q as CFDictionary, nil) == errSecSuccess
    }

    func loadData() -> Data? {
        var q = query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess else { return nil }
        return out as? Data
    }

    func delete() { SecItemDelete(query as CFDictionary) }
}
