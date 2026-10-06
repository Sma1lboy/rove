import Foundation

struct BridgeError: Error, LocalizedError, Equatable {
    var code: String
    var message: String
    var errorDescription: String? { message.isEmpty ? code : "\(message) (\(code))" }

    static let notConnected = BridgeError(code: "NOT_CONNECTED", message: "Not connected to the bridge")
    static let disconnected = BridgeError(code: "DISCONNECTED", message: "Connection lost")
    static let timeout = BridgeError(code: "TIMEOUT", message: "Request timed out")
    static let malformed = BridgeError(code: "MALFORMED", message: "Malformed response")
}

/// A decoded server → client frame. Payloads stay as JSON `Data` until a typed decode.
enum IncomingFrame: Equatable {
    case response(id: Int, result: Result<Data, BridgeError>)
    case event(name: String, data: Data)

    static func parse(_ raw: Data) -> IncomingFrame? {
        guard let obj = (try? JSONSerialization.jsonObject(with: raw)) as? [String: Any] else { return nil }
        if let name = obj["event"] as? String {
            return .event(name: name, data: reencode(obj["data"]))
        }
        guard let id = (obj["id"] as? NSNumber)?.intValue else { return nil }
        if (obj["ok"] as? Bool) == true {
            return .response(id: id, result: .success(reencode(obj["result"])))
        }
        let err = obj["error"] as? [String: Any]
        let e = BridgeError(code: err?["code"] as? String ?? "ERROR", message: err?["message"] as? String ?? "")
        return .response(id: id, result: .failure(e))
    }

    private static func reencode(_ value: Any?) -> Data {
        guard let value, !(value is NSNull), JSONSerialization.isValidJSONObject(value),
              let d = try? JSONSerialization.data(withJSONObject: value) else { return Data("{}".utf8) }
        return d
    }

    static func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        try JSONDecoder().decode(type, from: data)
    }
}

/// Typed push events surfaced to the app.
enum BridgeEvent {
    case connected
    case tasks(TasksPayload)
    case termData(stream: String, bytes: Data)
    case termExit(stream: String, code: Int?)
    case notice(Notice)

    static func from(name: String, data: Data) -> BridgeEvent? {
        switch name {
        case "tasks":
            return (try? JSONDecoder().decode(TasksPayload.self, from: data)).map(BridgeEvent.tasks)
        case "term.data":
            guard let e = try? JSONDecoder().decode(TermDataEvent.self, from: data),
                  let bytes = Data(base64Encoded: e.data) else { return nil }
            return .termData(stream: e.stream, bytes: bytes)
        case "term.exit":
            return (try? JSONDecoder().decode(TermExitEvent.self, from: data)).map { .termExit(stream: $0.stream, code: $0.code) }
        case "notice":
            return (try? JSONDecoder().decode(Notice.self, from: data)).map(BridgeEvent.notice)
        default:
            return nil
        }
    }
}

/// Reconnect backoff: 0.5, 1, 2, 4, 8, then 15s cap.
enum Backoff {
    static let steps: [Double] = [0.5, 1, 2, 4, 8, 15]
    static func delay(attempt: Int) -> Double { steps[min(max(attempt, 0), steps.count - 1)] }
}
