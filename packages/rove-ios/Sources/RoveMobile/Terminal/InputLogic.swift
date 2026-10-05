import Foundation

enum AccessoryKey: CaseIterable, Equatable {
    case esc, tab, shiftTab, ctrl, left, up, down, right, enter, ctrlC

    var label: String {
        switch self {
        case .esc: "Esc"
        case .tab: "Tab"
        case .shiftTab: "⇧Tab"
        case .ctrl: "Ctrl"
        case .left: "←"
        case .up: "↑"
        case .down: "↓"
        case .right: "→"
        case .enter: "Enter"
        case .ctrlC: "^C"
        }
    }
}

/// Maps accessory-row taps and typed text to pty bytes, tracking the sticky Ctrl modifier.
struct KeyMapper {
    private(set) var ctrlArmed = false

    static func sequence(for key: AccessoryKey) -> String? {
        switch key {
        case .esc: "\u{1b}"
        case .tab: "\t"
        case .shiftTab: "\u{1b}[Z"
        case .ctrl: nil
        case .up: "\u{1b}[A"
        case .down: "\u{1b}[B"
        case .right: "\u{1b}[C"
        case .left: "\u{1b}[D"
        case .enter: "\r"
        case .ctrlC: "\u{03}"
        }
    }

    /// Returns the text to send, or nil when the key only toggles Ctrl.
    mutating func press(_ key: AccessoryKey) -> String? {
        if key == .ctrl { ctrlArmed.toggle(); return nil }
        ctrlArmed = false
        return Self.sequence(for: key)
    }

    /// Applies a pending Ctrl to typed input: a single letter becomes its control byte (letter & 0x1f).
    mutating func transformTyped(_ text: String) -> String {
        guard ctrlArmed else { return text }
        ctrlArmed = false
        let scalars = Array(text.unicodeScalars)
        guard scalars.count == 1, let s = scalars.first, s.isASCII,
              (0x40...0x7f).contains(s.value) else { return text }
        return String(UnicodeScalar(UInt8(s.value & 0x1f)))
    }
}

/// SwiftTerm emits automatic replies to terminal queries via `send(source:data:)`. The bridge's
/// PTY host / attached TUI already answers those (answersQueries=false for the phone), so we drop
/// DA1/DA2, DECRQM and OSC 10/11/4 color replies and forward everything else (incl. cursor position reports).
enum QueryReplyFilter {
    private static let regex = try! NSRegularExpression(pattern:
        "\u{1B}\\[[?>][0-9;]*c" +                       // DA1 / DA2
        "|\u{1B}\\[\\??[0-9;]*\\$y" +                   // DECRQM
        "|\u{1B}\\](?:10|11|4);[^\u{07}\u{1B}]*(?:\u{07}|\u{1B}\\\\)")  // OSC color replies

    static func filter(_ bytes: [UInt8]) -> [UInt8] {
        guard bytes.contains(0x1B), let s = String(bytes: bytes, encoding: .isoLatin1) else { return bytes }
        let range = NSRange(s.startIndex..., in: s)
        let out = regex.stringByReplacingMatches(in: s, range: range, withTemplate: "")
        return Array(out.data(using: .isoLatin1) ?? Data(bytes))
    }
}
