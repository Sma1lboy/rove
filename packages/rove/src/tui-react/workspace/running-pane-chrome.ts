/**
 * Chrome for the workspace pane while the selected task works: a colour
 * gradient flows around the border, and the top edge names what is running.
 */

import { type OptimizedBuffer, RGBA, type Renderable } from "@opentui/core"
import { charWidth } from "../../lib/display-width"
import { flowInk, flowPalette, flowPhase, perimeter } from "../../tui/lib/border-flow"
import { mixInk } from "../../tui/lib/breathe"
import { truncateEndCells } from "../../tui/lib/truncate"

const TITLE_LABEL_CELLS = 32
/** Unfocused panes flow fainter so focus still reads at a glance. */
const UNFOCUSED_SHARE = 0.55
const CLEAR = RGBA.fromInts(0, 0, 0, 0)

/** `renderAfter` for the pane box: re-inks every border cell from the moving gradient. */
export function runningPaneFlow(accent: RGBA, inactive: RGBA, focused: boolean, tick: number, partnerDeg?: number) {
  const ramp = flowPalette(accent, partnerDeg)
  const palette = focused ? ramp : ramp.map((ink) => mixInk(ink, inactive, UNFOCUSED_SHARE))
  return function paint(this: Renderable, buffer: OptimizedBuffer): void {
    const cells = perimeter(this.width, this.height)
    const { char, attributes } = buffer.buffers
    cells.forEach(([dx, dy], index) => {
      const x = this.x + dx
      const y = this.y + dy
      if (x < 0 || y < 0 || x >= buffer.width || y >= buffer.height) return
      const cell = y * buffer.width + x
      const code = char[cell] ?? 0
      // Only plain codepoints (box glyphs, ASCII title text); packed graphemes keep their ink.
      if (code <= 0x20 || code > 0x10ffff) return
      const ink = flowInk(palette, flowPhase(index, cells.length, tick))
      if (!ink) return
      // Through the buffer API: raw writes to `buffers.fg` never reach the screen.
      buffer.setCellWithAlphaBlending(x, y, String.fromCodePoint(code), ink, CLEAR, attributes[cell] ?? 0)
    })
  }
}

export function runningPaneTitle(label: string, word: string): string {
  return ` ${truncateEndCells(label, TITLE_LABEL_CELLS, charWidth)} · ${word} `
}
