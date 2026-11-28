import SwiftUI
import UIKit

// quill design language (quill-all/DESIGN.md) in rove-web's default `claude` palette:
// paper / ink, terracotta as the one accent. Matte surfaces; the phone's floating buttons
// take rove-web's glass recipe (src/ui/glass.ts) as solid fills.
//
// This file is the only place a color is spelled. Everything else uses these tokens
// (`scripts/lint-colors.sh` fails the build on a raw `Color(...)`, `.black`, `.white`,
// `UIColor(...)` or a material anywhere else).
enum Theme {
    /// Raw palette: rove-web's default `claude` theme (rove/src/theme/claude.json, as prefs-theme.ts maps
    /// it), so the native screens match the page they wrap. Tokens below pick from it.
    private enum Hex {
        static let paperLight: UInt32 = 0xFAF9F5, paperDark: UInt32 = 0x141413
        static let surfaceLight: UInt32 = 0xF0EEE6, surfaceDark: UInt32 = 0x1A1917
        static let insetLight: UInt32 = 0xEAE7DF, insetDark: UInt32 = 0x2B2A27
        static let lineLight: UInt32 = 0xD9D5CC, lineDark: UInt32 = 0x3A3835
        static let inkLight: UInt32 = 0x1A1917, inkDark: UInt32 = 0xEAE7DF
        static let mutedLight: UInt32 = 0x5E5953, mutedDark: UInt32 = 0xA9A39A
        static let accentLight: UInt32 = 0xB5532F, accentDark: UInt32 = 0xCC785C
    }

    private static func dyn(_ light: UInt32, _ dark: UInt32, alpha: CGFloat = 1) -> Color {
        Color(uiColor: UIColor { traits in
            UIColor(hex: traits.userInterfaceStyle == .dark ? dark : light, alpha: alpha)
        })
    }

    /// The one page background per theme: every screen and every sheet body.
    static let paper = dyn(Hex.paperLight, Hex.paperDark)
    /// The one card / input fill per theme.
    static let surface = dyn(Hex.surfaceLight, Hex.surfaceDark)
    /// Read-only wells (code, tails, banners, footers) — never a card.
    static let inset = dyn(Hex.insetLight, Hex.insetDark)
    static let line = dyn(Hex.lineLight, Hex.lineDark)
    static let ink = dyn(Hex.inkLight, Hex.inkDark)
    static let muted = dyn(Hex.mutedLight, Hex.mutedDark)
    static let accent = dyn(Hex.accentLight, Hex.accentDark)
    static let accentSoft = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(hex: Hex.accentDark, alpha: 0.14) : UIColor(hex: Hex.accentLight, alpha: 0.10)
    })
    static let success = dyn(0x2E7C4C, 0x9ACA86)
    /// Failures only — terracotta never means error.
    static let error = dyn(0xAD2F36, 0xEC6F74)
    /// Quota at 75%+ and routine runs that were missed; palette `yellow` (packages/branding colors.ts).
    /// Not an error and not terracotta: it asks for a look, never for action.
    static let warning = dyn(0x8A6220, 0xE8C96B)

    /// rove-web's neutral glass (glass.ts) as a solid: inset at 60% over paper (opaque, so the shadow stays outside),
    /// an ink edge at 12%, `--shadow-popover`.
    static let glassFill = dyn(0xF0EEE8, 0x22211F)
    static let glassEdge = dyn(Hex.inkLight, Hex.inkDark, alpha: 0.12)
    static let glassShadow = Color(uiColor: UIColor(hex: 0x000000, alpha: 0.25))

    /// A CSS colour the page reports (`#rrggbb` or `rgb(r, g, b)`); nil for anything else or a transparent one.
    static func css(_ text: String) -> UIColor? {
        let t = text.trimmingCharacters(in: .whitespaces)
        if t.hasPrefix("#"), t.count == 7, let v = UInt32(t.dropFirst(), radix: 16) { return UIColor(hex: v) }
        guard t.hasPrefix("rgb") else { return nil }
        let n = t.split(whereSeparator: { !"0123456789.".contains($0) }).compactMap { Double($0) }
        guard n.count >= 3, n.count == 3 || n[3] > 0 else { return nil }
        return UIColor(red: n[0] / 255, green: n[1] / 255, blue: n[2] / 255, alpha: 1)
    }

    /// A colour the page reported, for SwiftUI.
    static func color(_ ui: UIColor) -> Color { Color(uiColor: ui) }

    /// The one modal scrim, both themes: espresso ink at a fixed opacity (never the system dim,
    /// which is grey in light, black in dark and varies with the detent).
    static let scrim = Color(uiColor: UIColor(hex: Hex.inkLight, alpha: 0.32))
    /// Soft drop shadow under floating bars and toasts.
    static let shadow = Color(uiColor: UIColor(hex: Hex.inkLight, alpha: 0.08))
    /// Fully opaque fill for alpha masks (only the alpha channel matters).
    static let maskOpaque = Color(uiColor: UIColor(hex: Hex.inkLight))

    /// The terminal is espresso in both themes and shares the dark theme's tokens: in light mode it
    /// reads as an inset espresso panel, not a different black. Engines draw for a dark background
    /// and never learn ours (query replies are filtered).
    enum Terminal {
        static let backgroundUI = UIColor(hex: Hex.paperDark)
        static let foregroundUI = UIColor(hex: Hex.inkDark)
        static let caretUI = UIColor(hex: Hex.accentDark)
        static let background = Color(uiColor: backgroundUI)
        static let foreground = Color(uiColor: foregroundUI)
        /// Controls drawn on the terminal (tools chip, find row): dark inset / line.
        static let control = Color(uiColor: UIColor(hex: Hex.insetDark))
        static let controlLine = Color(uiColor: UIColor(hex: Hex.lineDark))
        /// ANSI 0–15: the claude-theme xterm palette the harness photographs
        /// (rove-harness/src/lib/harness-terminal.ts); color 0 is the terminal background.
        static let ansi: [UInt32] = [
            Hex.paperDark, 0xEC6F74, 0x9ACA86, 0xE8C96B, 0x61AAF2, 0x9B87F5, 0xD4967E, Hex.mutedDark,
            0x6B665F, 0xEC6F74, 0x9ACA86, 0xE8C96B, 0x61AAF2, 0x9B87F5, 0xE0AB96, Hex.inkDark,
        ]
    }

    /// UIKit backdrops that are not themed surfaces (the camera preview).
    static let cameraBackdropUI = UIColor(hex: 0x000000)
    /// Behind the web shell while rove-web paints its first frame, so a launch doesn't flash white.
    static let paperUI = UIColor { UIColor(hex: $0.userInterfaceStyle == .dark ? Hex.paperDark : Hex.paperLight) }

    static let radius: CGFloat = 8
    static let smallRadius: CGFloat = 6

    /// Pinned DESIGN.md sizes scale with Larger Text from that base; capped so fixed-height rows hold.
    static func scaled(_ size: CGFloat, cap: CGFloat = 1.6) -> CGFloat {
        min(UIFontMetrics(forTextStyle: .body).scaledValue(for: size), size * cap)
    }

    static func mono(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        dynamic(.monospacedSystemFont(ofSize: size, weight: uiWeight(weight)), size)
    }

    static func face(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        dynamic(.systemFont(ofSize: size, weight: uiWeight(weight)), size)
    }

    /// The pinned size as a Dynamic Type font: it follows the Larger Text setting, up to `scaled`'s cap.
    private static func dynamic(_ font: UIFont, _ size: CGFloat) -> Font {
        Font(UIFontMetrics(forTextStyle: .body).scaledFont(for: font, maximumPointSize: size * 1.6))
    }

    private static func uiWeight(_ weight: Font.Weight) -> UIFont.Weight {
        switch weight {
        case .medium: .medium
        case .semibold: .semibold
        case .bold: .bold
        default: .regular
        }
    }

    static func kicker(_ text: String, color: Color = muted) -> some View {
        Text(text.uppercased())
            .font(mono(11, .medium))
            .tracking(1.2)
            .foregroundStyle(color)
            .lineLimit(1)
    }

    /// Critically damped house spring; fades under Reduce Motion.
    @MainActor
    static var spring: Animation {
        UIAccessibility.isReduceMotionEnabled
            ? .easeOut(duration: 0.15)
            : .spring(response: 0.35, dampingFraction: 1.0)
    }
}

extension UIColor {
    convenience init(hex: UInt32, alpha: CGFloat = 1) {
        self.init(red: CGFloat((hex >> 16) & 0xFF) / 255,
                  green: CGFloat((hex >> 8) & 0xFF) / 255,
                  blue: CGFloat(hex & 0xFF) / 255,
                  alpha: alpha)
    }
}

/// `[ rove ]` — terracotta brackets, ink word, mono bold.
struct BracketChip: View {
    var size: CGFloat = 17

    var body: some View {
        HStack(spacing: 0) {
            Text("[").foregroundStyle(Theme.accent)
            Text(verbatim: " rove ").foregroundStyle(Theme.ink)
            Text("]").foregroundStyle(Theme.accent)
        }
        .font(Theme.mono(size, .bold))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: "rove"))
    }
}

/// Scale 0.97 on touch-down, critically damped; a dim under Reduce Motion.
struct PressableButtonStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .contentShape(Rectangle())
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.97 : 1.0)
            .opacity(configuration.isPressed && reduceMotion ? 0.7 : 1.0)
            .animation(
                reduceMotion ? .easeOut(duration: 0.15) : .spring(response: 0.25, dampingFraction: 1.0),
                value: configuration.isPressed
            )
    }
}

extension ButtonStyle where Self == PressableButtonStyle {
    static var pressable: PressableButtonStyle { PressableButtonStyle() }
}

/// The TUI's braille spinner at 12.5 fps; static under Reduce Motion.
struct BrailleSpinner: View {
    var size: CGFloat = 11
    var tint: Color = Theme.accent

    private static let frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
    @State private var frame = 0

    var body: some View {
        Text(Self.frames[frame])
            .font(Theme.mono(size, .semibold))
            .foregroundStyle(tint)
            .accessibilityHidden(true)
            .task {
                guard !UIAccessibility.isReduceMotionEnabled else { return }
                while !Task.isCancelled {
                    try? await Task.sleep(for: .milliseconds(80))
                    frame = (frame + 1) % Self.frames.count
                }
            }
    }
}

extension View {
    /// Surface fill + hairline border, continuous corners — cards and idle buttons.
    func tile(_ fill: Color = Theme.surface, radius: CGFloat = Theme.radius, border: Color = Theme.line) -> some View {
        background(fill, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(border))
    }

    /// A choose-one tile: accent wash and border when selected, plain tile otherwise.
    func selectableTile(_ on: Bool) -> some View {
        tile(on ? Theme.accentSoft : Theme.surface, border: on ? Theme.accent : Theme.line)
            .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// Mono label on a surface tile — the idle-button grammar.
struct TileLabel: View {
    var text: String
    var tint: Color = Theme.ink
    var size: CGFloat = 13

    var body: some View {
        Text(text)
            .font(Theme.mono(size, .medium))
            .foregroundStyle(tint)
            .lineLimit(1)
            .padding(.horizontal, 12)
            .frame(minHeight: 36)
            .tile()
    }
}

/// Mono text field on a surface tile. At least 44 pt: an empty TextField lays out a taller line until it is
/// first edited, so without the floor the box (and everything under it) shrinks 3 pt on first focus.
struct FieldBox<Field: View>: View {
    @ViewBuilder var field: Field

    var body: some View {
        field
            .font(Theme.mono(14))
            .foregroundStyle(Theme.ink)
            .tint(Theme.accent)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .padding(.horizontal, 12).padding(.vertical, 11)
            .frame(minHeight: 44)
            .tile()
    }
}

/// Screen header that replaces the system navigation bar (no glass): optional back chevron,
/// a leading title block, trailing controls. Solid paper so nothing scrolls through it.
struct ScreenHeader<Title: View, Trailing: View>: View {
    var back: (() -> Void)?
    @ViewBuilder var title: Title
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            if let back {
                Button(action: back) {
                    Image(systemName: "chevron.left")
                        .font(Theme.face(17, .semibold))
                        .foregroundStyle(Theme.ink)
                        .frame(width: 36, height: 36)
                }
                .buttonStyle(.pressable)
                .accessibilityLabel("Back")
                .accessibilityIdentifier("backButton")
            }
            title.frame(maxWidth: .infinity, alignment: .leading)
            trailing
        }
        .padding(.horizontal, back == nil ? 20 : 10)
        .padding(.trailing, back == nil ? 0 : 10)
        .frame(minHeight: 52)
        .background(Theme.paper)
    }
}

/// Header icon button: SF Symbol in muted ink, 36pt hit area.
struct HeaderIcon: View {
    var systemName: String
    var tint: Color = Theme.muted

    var body: some View {
        Image(systemName: systemName)
            .font(Theme.face(17))
            .foregroundStyle(tint)
            .frame(width: 36, height: 36)
    }
}

extension TaskGroup {
    /// The derived-group id, verbatim — the same words `rove api context` prints.
    var tag: String { rawValue }

    /// Accent only for what needs a person; error red is never a group colour.
    var tone: Color {
        switch self {
        case .waitingOnYou: Theme.accent
        case .landing: Theme.success
        case .readyForReview, .working: Theme.ink
        case .idle, .unknown: Theme.muted
        }
    }
}

/// Mono status tag; `working` breathes with the braille spinner. `unknown` (no engine signal yet)
/// draws nothing, as in the TUI.
struct StatusTag: View {
    var group: TaskGroup

    var body: some View {
        if group != .unknown {
            HStack(spacing: 4) {
                if group == .working { BrailleSpinner(size: 11, tint: Theme.accent) }
                Text(group.tag)
                    .font(Theme.mono(11, group == .waitingOnYou ? .bold : .medium))
                    .foregroundStyle(group.tone)
                    .lineLimit(1)
                    .fixedSize()
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("status-\(group.tag)")
        }
    }
}

/// Hidden navigation bars disable the edge swipe; keep it whenever there is somewhere to go back to.
extension UINavigationController: @retroactive UIGestureRecognizerDelegate {
    override open func viewDidLoad() {
        super.viewDidLoad()
        interactivePopGestureRecognizer?.delegate = self
    }

    public func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        viewControllers.count > 1
    }
}
