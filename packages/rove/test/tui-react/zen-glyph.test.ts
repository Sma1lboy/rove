import { zenChipGlyph } from "@/tui-react/panes/sidebar/zen-glyph"
import { describe, expect, test } from "vitest"

describe("zenChipGlyph", () => {
  test("keeps ☯ on macOS, where the code point gets text presentation", () => {
    expect(zenChipGlyph("darwin")).toBe("☯")
  })

  // The bug this exists for: Linux fontconfig renders a bare U+262F as a
  // colored double-width emoji that overruns its single reserved cell.
  test.each(["linux", "win32", "freebsd"] as NodeJS.Platform[])(
    "falls back to a monochrome glyph on %s",
    (platform) => {
      expect(zenChipGlyph(platform)).toBe("◐")
    },
  )
})
