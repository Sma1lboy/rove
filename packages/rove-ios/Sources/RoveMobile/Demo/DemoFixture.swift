import Foundation

/// The in-app fixture bridge: answers ops from the bundled `demo-fixture.json`, in memory.
/// `scripts/fixture-bridge.ts` serves the same file over a socket for the UI tests and resolves it by
/// the same rules (its header documents the format):
///   `$by`     pick the result by request args (`"taskId"` or `["taskId","tabId"]`, joined with `:`), `*` falls back
///   `$same_as`   answer like another op
///   `$ago_min` / `$in_min`   a time relative to now: ISO-8601, or epoch ms with `"$as": "ms"`
///   `$b64`    base64 of the UTF-8 text (terminal replays)
struct DemoFixture {
    private let ops: [String: Any]

    init(data: Data) throws {
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw BridgeError.malformed }
        ops = object
    }

    /// The fixture shipped in the app bundle.
    static func bundled() -> DemoFixture? {
        guard let url = Bundle.main.url(forResource: "demo-fixture", withExtension: "json"),
              let data = try? Data(contentsOf: url) else { return nil }
        return try? DemoFixture(data: data)
    }

    /// The JSON result for one request. An op the fixture does not name answers `{}`, which is what every
    /// write op the app decodes as `EmptyResult` needs.
    func answer(_ op: String, _ args: [String: Any] = [:], now: Date = Date()) -> Data {
        var entry: Any = ops[op] ?? [String: Any]()
        if let same = (entry as? [String: Any])?["$same_as"] as? String { entry = ops[same] ?? [String: Any]() }
        if let table = entry as? [String: Any], let by = table["$by"] {
            let fields = (by as? [String]) ?? [by as? String ?? ""]
            let key = fields.map { args[$0].map { "\($0)" } ?? "" }.joined(separator: ":")
            entry = table[key] ?? table["*"] ?? [String: Any]()
        }
        return (try? JSONSerialization.data(withJSONObject: Self.resolve(entry, now: now))) ?? Data("{}".utf8)
    }

    /// Replaces the `$ago_min` / `$in_min` / `$b64` markers anywhere in `value`.
    static func resolve(_ value: Any, now: Date) -> Any {
        if let array = value as? [Any] { return array.map { resolve($0, now: now) } }
        guard let dict = value as? [String: Any] else { return value }
        let ago = (dict["$ago_min"] as? NSNumber)?.doubleValue
        if let minutes = ago ?? (dict["$in_min"] as? NSNumber)?.doubleValue {
            let at = now.addingTimeInterval((ago == nil ? 1 : -1) * minutes * 60)
            return (dict["$as"] as? String) == "ms" ? Int64(at.timeIntervalSince1970 * 1000) : iso.string(from: at)
        }
        if let text = dict["$b64"] as? String { return Data(text.utf8).base64EncodedString() }
        return dict.mapValues { resolve($0, now: now) }
    }

    private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
}
