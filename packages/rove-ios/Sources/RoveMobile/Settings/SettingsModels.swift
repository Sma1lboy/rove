import Foundation

// Wire models and pure logic for Settings: usage meters, the daemon build notice, engines,
// plugins, and the agent-insight reads (engine history, digest, turns). Optional fields decode
// to defaults so an older or newer bridge never fails a whole screen.

// MARK: - Usage

struct UsageWindow: Codable, Hashable {
    var kind: String
    var label: String
    var percent: Int
    /// Epoch ms the window resets, or nil when the engine did not say.
    var resetsAt: Double?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        kind = try c.decodeIfPresent(String.self, forKey: .kind) ?? ""
        label = try c.decodeIfPresent(String.self, forKey: .label) ?? kind
        percent = try c.decodeIfPresent(Int.self, forKey: .percent) ?? 0
        resetsAt = try c.decodeIfPresent(Double.self, forKey: .resetsAt)
    }
}

struct UsageVendor: Codable, Hashable, Identifiable {
    var vendor: String
    var name: String?
    var capturedAt: Double
    var windows: [UsageWindow]

    var id: String { vendor }
    var displayName: String { name ?? vendor }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        vendor = try c.decode(String.self, forKey: .vendor)
        name = try c.decodeIfPresent(String.self, forKey: .name)
        capturedAt = try c.decodeIfPresent(Double.self, forKey: .capturedAt) ?? 0
        windows = try c.decodeIfPresent([UsageWindow].self, forKey: .windows) ?? []
    }
}

/// `usage` is nil until the daemon has sent a first snapshot, and an empty list when no engine reports quota.
struct UsagePayload: Codable {
    var usage: [UsageVendor]?

    init(from decoder: Decoder) throws {
        usage = try decoder.container(keyedBy: CodingKeys.self).decodeIfPresent([UsageVendor].self, forKey: .usage)
    }
}

enum UsageTone: Equatable {
    case ok, warn, crit

    /// 75% and 95% are the TUI's thresholds (`usage-core.ts`).
    static func of(percent: Int) -> UsageTone { percent >= 95 ? .crit : percent >= 75 ? .warn : .ok }
}

enum UsageLogic {
    /// Compact local reset stamp as the TUI prints it: within 24h just the clock (`→ 14:00`),
    /// beyond that day and clock (`→ 7/30 14:00`), empty when the engine reported none.
    static func resetText(_ resetsAt: Double?, now: Date, calendar: Calendar = .current) -> String {
        guard let resetsAt, resetsAt / 1000 > now.timeIntervalSince1970 else { return "" }
        let date = Date(timeIntervalSince1970: resetsAt / 1000)
        let c = calendar.dateComponents([.month, .day, .hour, .minute], from: date)
        let clock = String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
        if resetsAt / 1000 - now.timeIntervalSince1970 < 24 * 3600 { return "→ \(clock)" }
        return "→ \(c.month ?? 0)/\(c.day ?? 0) \(clock)"
    }

    /// The tightest window of a vendor, for a one-line summary.
    static func worst(_ v: UsageVendor) -> UsageWindow? { v.windows.max { $0.percent < $1.percent } }
}

// MARK: - Daemon build notice

struct DaemonInfo: Codable, Equatable {
    var daemonVersion: String?
    var bridgeVersion: String?
    var stale: Bool
    var uptimeMs: Double?
    var startedAt: String?
    var taskCount: Int?
    var attachedClients: Int?
    var automationHold: Bool?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        daemonVersion = try c.decodeIfPresent(String.self, forKey: .daemonVersion)
        bridgeVersion = try c.decodeIfPresent(String.self, forKey: .bridgeVersion)
        stale = try c.decodeIfPresent(Bool.self, forKey: .stale) ?? false
        uptimeMs = try c.decodeIfPresent(Double.self, forKey: .uptimeMs)
        startedAt = try c.decodeIfPresent(String.self, forKey: .startedAt)
        taskCount = try c.decodeIfPresent(Int.self, forKey: .taskCount)
        attachedClients = try c.decodeIfPresent(Int.self, forKey: .attachedClients)
        automationHold = try c.decodeIfPresent(Bool.self, forKey: .automationHold)
    }
}

// MARK: - Engines

struct EngineSetting: Codable, Hashable, Identifiable {
    var id: String
    var name: String
    var builtin: Bool
    var custom: Bool
    var enabled: Bool
    var isDefault: Bool
    var canBeDefault: Bool
    /// The launch program only; arguments never leave the Mac.
    var binary: String?
    var customized: Bool
    var protocolName: String?
    var binaryFound: Bool?
    var binaryPath: String?
    /// `yes`, `no` or `unknown` (no account detector for this engine).
    var login: String
    /// `installed`, `outdated`, `not-installed` or `unsupported`.
    var hooks: String
    var markers: Bool
    var screen: Bool
    var configIssue: String?

    enum CodingKeys: String, CodingKey {
        case id, name, builtin, custom, enabled, isDefault, canBeDefault, binary, customized
        case protocolName = "protocol"
        case binaryFound, binaryPath, login, hooks, markers, screen, configIssue
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? id
        builtin = try c.decodeIfPresent(Bool.self, forKey: .builtin) ?? false
        custom = try c.decodeIfPresent(Bool.self, forKey: .custom) ?? false
        enabled = try c.decodeIfPresent(Bool.self, forKey: .enabled) ?? true
        isDefault = try c.decodeIfPresent(Bool.self, forKey: .isDefault) ?? false
        canBeDefault = try c.decodeIfPresent(Bool.self, forKey: .canBeDefault) ?? false
        binary = try c.decodeIfPresent(String.self, forKey: .binary)
        customized = try c.decodeIfPresent(Bool.self, forKey: .customized) ?? false
        protocolName = try c.decodeIfPresent(String.self, forKey: .protocolName)
        binaryFound = try c.decodeIfPresent(Bool.self, forKey: .binaryFound)
        binaryPath = try c.decodeIfPresent(String.self, forKey: .binaryPath)
        login = try c.decodeIfPresent(String.self, forKey: .login) ?? "unknown"
        hooks = try c.decodeIfPresent(String.self, forKey: .hooks) ?? "unsupported"
        markers = try c.decodeIfPresent(Bool.self, forKey: .markers) ?? false
        screen = try c.decodeIfPresent(Bool.self, forKey: .screen) ?? false
        configIssue = try c.decodeIfPresent(String.self, forKey: .configIssue)
    }
}

struct EnginesSettingsPayload: Codable {
    var defaultId: String?
    var engines: [EngineSetting]

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        defaultId = try c.decodeIfPresent(String.self, forKey: .defaultId)
        engines = try c.decodeIfPresent([EngineSetting].self, forKey: .engines) ?? []
    }
}

enum EngineLogic {
    /// What the bridge would refuse, said before the tap: the last enabled engine stays on.
    static func canDisable(_ engine: EngineSetting, in all: [EngineSetting]) -> Bool {
        all.contains { $0.id != engine.id && $0.enabled }
    }

    /// One mono word per fact, the TUI's second line: `claude ok · logged in`.
    static func loginText(_ e: EngineSetting) -> String {
        switch e.login {
        case "yes": String(localized: "logged in")
        case "no": String(localized: "no account")
        default: String(localized: "login unknown")
        }
    }

    /// How the engine reports to Rove: hooks, completion markers, screen rules.
    static func reportText(_ e: EngineSetting) -> String {
        let hooks: String
        switch e.hooks {
        case "installed": hooks = String(localized: "hooks installed")
        case "outdated": hooks = String(localized: "hooks outdated")
        case "not-installed": hooks = String(localized: "hooks missing")
        default: hooks = String(localized: "no hooks")
        }
        return [hooks,
                e.markers ? String(localized: "markers") : String(localized: "no markers"),
                e.screen ? String(localized: "screen rules") : String(localized: "no screen rules")].joined(separator: " · ")
    }
}

// MARK: - Plugins

struct PluginDeclares: Codable, Hashable {
    var actions: Int
    var events: Int
    var panes: Int
    var engines: Int
}

struct PluginLastRun: Codable, Hashable {
    var at: Double
    var label: String
    var ok: Bool
    var running: Bool

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        at = try c.decodeIfPresent(Double.self, forKey: .at) ?? 0
        label = try c.decodeIfPresent(String.self, forKey: .label) ?? "run"
        ok = try c.decodeIfPresent(Bool.self, forKey: .ok) ?? false
        running = try c.decodeIfPresent(Bool.self, forKey: .running) ?? false
    }
}

struct PluginInfo: Codable, Hashable, Identifiable {
    var id: String
    var version: String
    var enabled: Bool
    var linked: Bool
    var platformOk: Bool
    var hooksDeclared: Bool
    var updateAvailable: Bool
    var declares: PluginDeclares?
    var lastRun: PluginLastRun?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        version = try c.decodeIfPresent(String.self, forKey: .version) ?? ""
        enabled = try c.decodeIfPresent(Bool.self, forKey: .enabled) ?? false
        linked = try c.decodeIfPresent(Bool.self, forKey: .linked) ?? false
        platformOk = try c.decodeIfPresent(Bool.self, forKey: .platformOk) ?? true
        hooksDeclared = try c.decodeIfPresent(Bool.self, forKey: .hooksDeclared) ?? false
        updateAvailable = try c.decodeIfPresent(Bool.self, forKey: .updateAvailable) ?? false
        declares = try c.decodeIfPresent(PluginDeclares.self, forKey: .declares)
        lastRun = try c.decodeIfPresent(PluginLastRun.self, forKey: .lastRun)
    }
}

struct PluginsPayload: Codable {
    var plugins: [PluginInfo]

    init(from decoder: Decoder) throws {
        plugins = try decoder.container(keyedBy: CodingKeys.self).decodeIfPresent([PluginInfo].self, forKey: .plugins) ?? []
    }
}

// MARK: - Engine history (`read-output`)

struct OutputBlock: Codable, Hashable {
    /// `text`, `tool_call`, `tool_result`, or an engine-specific type the app shows verbatim.
    var type: String
    var text: String?
    var name: String?
    var input: String?
    var output: String?

    enum CodingKeys: String, CodingKey { case type, text, name, input, output }

    init(type: String, text: String? = nil, name: String? = nil, input: String? = nil, output: String? = nil) {
        self.type = type; self.text = text; self.name = name; self.input = input; self.output = output
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        type = try c.decodeIfPresent(String.self, forKey: .type) ?? "text"
        text = try c.decodeIfPresent(String.self, forKey: .text)
        name = try c.decodeIfPresent(String.self, forKey: .name)
        input = Self.flatten(c, .input)
        output = Self.flatten(c, .output)
    }

    /// Tool input and output are a string for some engines and a list of `{type, text}` parts for others.
    private static func flatten(_ c: KeyedDecodingContainer<CodingKeys>, _ key: CodingKeys) -> String? {
        if let s = try? c.decodeIfPresent(String.self, forKey: key) { return s }
        struct Part: Decodable { var text: String? }
        if let parts = try? c.decodeIfPresent([Part].self, forKey: key) {
            let joined = parts.compactMap(\.text).joined(separator: "\n")
            return joined.isEmpty ? nil : joined
        }
        return nil
    }
}

struct OutputMessage: Codable, Hashable, Identifiable {
    var role: String
    var blocks: [OutputBlock]
    var timestamp: String?
    /// Position in the page; the wire has no message id.
    var id: Int = 0

    enum CodingKeys: String, CodingKey { case role, blocks, timestamp }

    init(role: String, blocks: [OutputBlock], timestamp: String? = nil, id: Int = 0) {
        self.role = role; self.blocks = blocks; self.timestamp = timestamp; self.id = id
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        role = try c.decodeIfPresent(String.self, forKey: .role) ?? "assistant"
        blocks = try c.decodeIfPresent([OutputBlock].self, forKey: .blocks) ?? []
        timestamp = try c.decodeIfPresent(String.self, forKey: .timestamp)
    }
}

struct OutputHistory: Codable, Hashable {
    var messages: [OutputMessage]
    var totalMessages: Int?
    var limited: Bool

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let raw = try c.decodeIfPresent([OutputMessage].self, forKey: .messages) ?? []
        messages = raw.enumerated().map { OutputMessage(role: $1.role, blocks: $1.blocks, timestamp: $1.timestamp, id: $0) }
        totalMessages = try c.decodeIfPresent(Int.self, forKey: .totalMessages)
        limited = try c.decodeIfPresent(Bool.self, forKey: .limited) ?? false
    }
}

struct OutputTerminal: Codable, Hashable {
    var tail: String
    var truncated: Bool
    var live: Bool

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        tail = try c.decodeIfPresent(String.self, forKey: .tail) ?? ""
        truncated = try c.decodeIfPresent(Bool.self, forKey: .truncated) ?? false
        live = try c.decodeIfPresent(Bool.self, forKey: .live) ?? false
    }
}

struct OutputEnvelope: Codable {
    var vendor: String?
    var running: Bool
    /// `history` (the engine's own transcript) or `terminal` (a labeled tail).
    var source: String
    var history: OutputHistory?
    var terminal: OutputTerminal?
    var cursor: String?
    /// Why the read fell back to the terminal tail, when it did.
    var fallbackReason: String?
    var warnings: [String]

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        vendor = try c.decodeIfPresent(String.self, forKey: .vendor)
        running = try c.decodeIfPresent(Bool.self, forKey: .running) ?? false
        source = try c.decodeIfPresent(String.self, forKey: .source) ?? "terminal"
        history = try c.decodeIfPresent(OutputHistory.self, forKey: .history)
        terminal = try c.decodeIfPresent(OutputTerminal.self, forKey: .terminal)
        cursor = try c.decodeIfPresent(String.self, forKey: .cursor)
        fallbackReason = try c.decodeIfPresent(String.self, forKey: .fallbackReason)
        warnings = try c.decodeIfPresent([String].self, forKey: .warnings) ?? []
    }
}

// MARK: - Digest and turns

struct DigestResult: Codable {
    var repo: String
    var since: String
    var tasksTotal: Int
    var routineRuns: Int
    var byStatus: [String: Int]

    enum CodingKeys: String, CodingKey { case repo, since, tasks, routines }
    private struct Tasks: Codable { var total: Int? }
    private struct Routines: Codable { var runs: Int?; var byStatus: [String: Int]? }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        repo = try c.decodeIfPresent(String.self, forKey: .repo) ?? ""
        since = try c.decodeIfPresent(String.self, forKey: .since) ?? ""
        tasksTotal = try c.decodeIfPresent(Tasks.self, forKey: .tasks)?.total ?? 0
        let routines = try c.decodeIfPresent(Routines.self, forKey: .routines)
        routineRuns = routines?.runs ?? 0
        byStatus = routines?.byStatus ?? [:]
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(repo, forKey: .repo)
        try c.encode(since, forKey: .since)
        try c.encode(Tasks(total: tasksTotal), forKey: .tasks)
        try c.encode(Routines(runs: routineRuns, byStatus: byStatus), forKey: .routines)
    }
}

struct TurnTotals: Codable, Hashable {
    var turns: Int
    var inputTokens: Int
    var outputTokens: Int
    var cacheReadTokens: Int
    var cacheCreationTokens: Int
    var durationMs: Double
    var byModel: [String: Int]

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        turns = try c.decodeIfPresent(Int.self, forKey: .turns) ?? 0
        inputTokens = try c.decodeIfPresent(Int.self, forKey: .inputTokens) ?? 0
        outputTokens = try c.decodeIfPresent(Int.self, forKey: .outputTokens) ?? 0
        cacheReadTokens = try c.decodeIfPresent(Int.self, forKey: .cacheReadTokens) ?? 0
        cacheCreationTokens = try c.decodeIfPresent(Int.self, forKey: .cacheCreationTokens) ?? 0
        durationMs = try c.decodeIfPresent(Double.self, forKey: .durationMs) ?? 0
        byModel = try c.decodeIfPresent([String: Int].self, forKey: .byModel) ?? [:]
    }
}

struct TurnRecord: Codable, Hashable, Identifiable {
    var id: String
    var taskId: String?
    var vendor: String?
    var model: String?
    var startedAt: Double
    var endedAt: Double

    var durationMs: Double { max(0, endedAt - startedAt) }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        taskId = try c.decodeIfPresent(String.self, forKey: .taskId)
        vendor = try c.decodeIfPresent(String.self, forKey: .vendor)
        model = try c.decodeIfPresent(String.self, forKey: .model)
        startedAt = try c.decodeIfPresent(Double.self, forKey: .startedAt) ?? 0
        endedAt = try c.decodeIfPresent(Double.self, forKey: .endedAt) ?? 0
    }
}

struct TurnsResult: Codable {
    var since: String
    var totals: TurnTotals
    var turns: [TurnRecord]

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        since = try c.decodeIfPresent(String.self, forKey: .since) ?? ""
        totals = try c.decode(TurnTotals.self, forKey: .totals)
        turns = try c.decodeIfPresent([TurnRecord].self, forKey: .turns) ?? []
    }
}

enum InsightLogic {
    /// `1.2k`, `48k`, `3.4m`: token counts as the stats screen prints them.
    static func compact(_ n: Int) -> String {
        switch n {
        case ..<1_000: return "\(n)"
        case ..<10_000: return String(format: "%.1fk", Double(n) / 1_000)
        case ..<1_000_000: return "\(n / 1_000)k"
        default: return String(format: "%.1fm", Double(n) / 1_000_000)
        }
    }

    /// `4m07s`, `2h03m`: wall-clock of the summed turns.
    static func duration(ms: Double) -> String { TaskListLogic.clock(ms: ms) }
}
