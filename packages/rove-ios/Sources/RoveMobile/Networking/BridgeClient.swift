import Foundation
import Observation

enum ConnectionState: Equatable {
    case disconnected
    case connecting
    case connected
    case reconnecting(attempt: Int)
    case failed(String)

    var label: String {
        switch self {
        case .disconnected: String(localized: "Disconnected")
        case .connecting: String(localized: "Connecting…")
        case .connected: String(localized: "Connected")
        case .reconnecting(let n): String(localized: "Reconnecting (try \(n))…")
        case .failed(let m): m
        }
    }
}

/// One WebSocket to rove-bridge: id-correlated requests, push events, auto-reconnect.
@MainActor @Observable
final class BridgeClient {
    private(set) var state: ConnectionState = .disconnected
    private(set) var hello: HelloResult?

    @ObservationIgnored private var socket: URLSessionWebSocketTask?
    @ObservationIgnored private var session: URLSession?
    @ObservationIgnored private var runner: Task<Void, Never>?
    /// Set in demo mode: every request is answered from this in-memory fixture and nothing touches the network.
    @ObservationIgnored private var demo: DemoFixture?
    @ObservationIgnored private var nextId = 1
    @ObservationIgnored private var pending: [Int: CheckedContinuation<Data, Error>] = [:]
    @ObservationIgnored private var observers: [UUID: (BridgeEvent) -> Void] = [:]

    // MARK: Observers

    @discardableResult
    func observe(_ handler: @escaping (BridgeEvent) -> Void) -> UUID {
        let id = UUID()
        observers[id] = handler
        return id
    }

    func removeObserver(_ id: UUID) { observers[id] = nil }

    /// Same events as an AsyncStream; the stream ends when the consumer stops iterating.
    func events() -> AsyncStream<BridgeEvent> {
        AsyncStream { cont in
            let id = observe { cont.yield($0) }
            cont.onTermination = { [weak self] _ in Task { @MainActor in self?.removeObserver(id) } }
        }
    }

    private func emit(_ e: BridgeEvent) { for h in observers.values { h(e) } }

    // MARK: Lifecycle

    func connect(_ pairing: Pairing) {
        stop()
        state = .connecting
        runner = Task { [weak self] in await self?.run(pairing) }
    }

    func disconnect() {
        stop()
        state = .disconnected
    }

    /// Demo mode: connected to the in-app fixture bridge. No socket, no URLSession; `request` answers from
    /// the fixture, `fire` (keystrokes, resize, detach) is dropped, and `connected` goes out as for a real hello.
    func connectDemo(_ fixture: DemoFixture) {
        stop()
        demo = fixture
        hello = try? IncomingFrame.decode(HelloResult.self, from: fixture.answer("hello"))
        state = .connected
        emit(.connected)
    }

    private func stop() {
        runner?.cancel(); runner = nil
        demo = nil
        teardownSocket()
    }

    private func teardownSocket() {
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        session?.invalidateAndCancel(); session = nil
        let waiting = pending
        pending = [:]
        for (_, c) in waiting { c.resume(throwing: BridgeError.disconnected) }
        hello = nil
    }

    private func run(_ pairing: Pairing) async {
        var attempt = 0
        while !Task.isCancelled {
            let req = makeConnectRequest(pairing)
            let session = URLSession(configuration: .default)
            let task = session.webSocketTask(with: req)
            self.session = session
            self.socket = task
            task.resume()

            // `hello` proves the upgrade succeeded; it resolves on the receive loop below.
            Task { [weak self] in
                guard let self else { return }
                if let h = try? await self.request("hello", as: HelloResult.self) {
                    guard self.socket === task else { return }
                    self.hello = h
                    self.state = .connected
                    attempt = 0
                    self.emit(.connected)
                }
            }

            var fatal: String?
            do {
                while true {
                    let msg = try await task.receive()
                    switch msg {
                    case .string(let s): handle(Data(s.utf8))
                    case .data(let d): handle(d)
                    @unknown default: break
                    }
                }
            } catch {
                if (task.response as? HTTPURLResponse)?.statusCode == 401 {
                    fatal = ConnectRequest.unauthorizedMessage
                }
            }
            if Task.isCancelled { return }
            teardownSocket()
            if let fatal { state = .failed(fatal); return }
            attempt += 1
            state = .reconnecting(attempt: attempt)
            try? await Task.sleep(for: .seconds(Backoff.delay(attempt: attempt - 1)))
        }
    }

    // MARK: Frames

    private func handle(_ raw: Data) {
        switch IncomingFrame.parse(raw) {
        case .response(let id, let result)?:
            guard let c = pending.removeValue(forKey: id) else { return }
            switch result {
            case .success(let d): c.resume(returning: d)
            case .failure(let e): c.resume(throwing: e)
            }
        case .event(let name, let data)?:
            if let e = BridgeEvent.from(name: name, data: data) { emit(e) }
        case nil:
            break
        }
    }

    // MARK: Requests

    private func frame(id: Int, op: String, args: [String: Any]) -> String? {
        let obj: [String: Any] = ["id": id, "op": op, "args": args]
        guard let d = try? JSONSerialization.data(withJSONObject: obj) else { return nil }
        return String(data: d, encoding: .utf8)
    }

    /// `timeout` is seconds to wait for the answer; long ops (a repo clone) pass more than the default.
    func request<T: Decodable>(_ op: String, _ args: [String: Any] = [:], timeout: Double = 30, as type: T.Type = EmptyResult.self) async throws -> T {
        if let demo { return try IncomingFrame.decode(T.self, from: demo.answer(op, args)) }
        guard let socket else { throw BridgeError.notConnected }
        let id = nextId; nextId += 1
        guard let text = frame(id: id, op: op, args: args) else { throw BridgeError.malformed }
        let data: Data = try await withCheckedThrowingContinuation { cont in
            pending[id] = cont
            socket.send(.string(text)) { [weak self] err in
                guard let err else { return }
                Task { @MainActor in
                    self?.pending.removeValue(forKey: id)?.resume(throwing: BridgeError(code: "SEND_FAILED", message: err.localizedDescription))
                }
            }
            Task { [weak self] in
                try? await Task.sleep(for: .seconds(timeout))
                self?.pending.removeValue(forKey: id)?.resume(throwing: BridgeError.timeout)
            }
        }
        return try IncomingFrame.decode(T.self, from: data)
    }

    /// Fire-and-forget (keystrokes, resize). Sends synchronously so ordering is preserved.
    func fire(_ op: String, _ args: [String: Any] = [:]) {
        guard demo == nil else { return }
        guard let socket else { return }
        let id = nextId; nextId += 1
        guard let text = frame(id: id, op: op, args: args) else { return }
        socket.send(.string(text)) { _ in }
    }
}
