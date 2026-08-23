import { describe, expect, test } from "bun:test"
import { zenChipGlyph } from "@/tui-react/panes/sidebar/zen-glyph"

describe("zenChipGlyph", () => {
  test("keeps ☯ on macOS, where the code point gets text presentation", () => {
    expect(zenChipGlyph("darwin")).toBe("☯")
  })

  test("falls back to a monochrome glyph everywhere else", () => {
    // The bug this exists for: Linux fontconfig renders a bare U+262F as a
    // colored double-width emoji that overruns its single reserved cell.
    for (const platform of ["linux", "win32", "freebsd"] as NodeJS.Platform[]) {
      expect(zenChipGlyph(platform)).toBe("◐")
    }
  })

  test("no fallback glyph carries an emoji presentation of its own", () => {
    // Anything in the emoji/pictograph planes is exactly what we're escaping.
    for (const platform of ["linux", "win32"] as NodeJS.Platform[]) {
      const cp = zenChipGlyph(platform).codePointAt(0) as number
      expect(cp).toBeLessThan(0x1f000)
      expect(cp === 0x262f).toBe(false)
    }
  })
})
