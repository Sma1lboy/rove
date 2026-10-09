import SwiftTerm
import UIKit

/// The terminal typeface: bundled Maple Mono NF (UIAppFonts), whose Nerd Font icons and powerline
/// separators SF Mono lacks. CJK has no glyphs here and falls back to the system font, still two cells.
/// If the bundled faces fail to load, the terminal uses the system monospace.
enum TerminalFont {
    static let family = "Maple Mono NF"
    /// Only Regular and Bold ship; italic is those faces slanted, which adds no bytes to the app.
    private static let slant = CGAffineTransform(a: 1, b: 0, c: tan(12 * .pi / 180), d: 1, tx: 0, ty: 0)

    @MainActor static func apply(to tv: TerminalView, size: CGFloat) {
        guard let regular = UIFont(name: "MapleMono-NF-Regular", size: size),
              let bold = UIFont(name: "MapleMono-NF-Bold", size: size) else {
            tv.font = UIFont.monospacedSystemFont(ofSize: size, weight: .regular)
            return
        }
        tv.setFonts(normal: regular, bold: bold, italic: slanted(regular), boldItalic: slanted(bold))
    }

    private static func slanted(_ font: UIFont) -> UIFont {
        UIFont(descriptor: font.fontDescriptor.withMatrix(slant), size: 0)
    }
}
