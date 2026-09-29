/**
 * Chrome for the workspace pane while the selected task works: the border
 * rests in a dimmed accent while comets of light run around it, and the top
 * edge names what is running.
 */

import { type OptimizedBuffer, RGBA, type Renderable } from "@opentui/core"
import { charWidth } from "../../lib/display-width"
import { flowInk, flowIntensity, flowPalette, perimeter } from "../../tui/lib/border-flow"
import { mixInk } from "../../tui/lib/breathe"
import { truncateEndCells } from "../../tui/lib/truncate"

const TITLE_LABEL_CELLS = 32
/** Unfocused panes run a fainter light so focus still reads at a glance. */
const UNFOCUSED_SHARE = 0.55
const CLEAR = RGBA.fromInts(0, 0, 0, 0)
/** Near the head, light lines turn heavy so the comet reads on a one-pixel border. */
const HEAVY_FROM = 0.45
const HEAVY: Record<number, number> = { 0x2500: 0x2501, 0x2502: 0x2503 }

export function runningPaneRest(accent: RGBA, inactive: RGBA, focused: boolean): RGBA {
  return mixInk(accent, inactive, focused ? 0.2 : 0.08)
}

/** `renderAfter` for the pane box: re-inks only the border cells a comet lights. */
export function runningPaneFlow(accent: RGBA, inactive: RGBA, focused: boolean, tick: number) {
  const head = focused ? accent : mixInk(accent, inactive, UNFOCUSED_SHARE)
  const palette = flowPalette(head, runningPaneRest(accent, inactive, focused))
  return function paint(this: Renderable, buffer: OptimizedBuffer): void {
    const cells = perimeter(this.width, this.height)
    const { char, attributes } = buffer.buffers
    cells.forEach(([dx, dy], index) => {
      const intensity = flowIntensity(index, cells.length, tick)
      const ink = flowInk(palette, intensity)
      const x = this.x + dx
      const y = this.y + dy
      if (!ink || x < 0 || y < 0 || x >= buffer.width || y >= buffer.height) return
      const cell = y * buffer.width + x
      const code = char[cell] ?? 0
      // Only plain codepoints (box glyphs, ASCII title text); packed graphemes keep their ink.
      if (code <= 0x20 || code > 0x10ffff) return
      // Writes through the buffer API so the renderer sees the change.
      const glyph = intensity > HEAVY_FROM ? (HEAVY[code] ?? code) : code
      buffer.setCellWithAlphaBlending(x, y, String.fromCodePoint(glyph), ink, CLEAR, attributes[cell] ?? 0)
    })
  }
}

export function runningPaneTitle(label: string, word: string): string {
  return ` ${truncateEndCells(label, TITLE_LABEL_CELLS, charWidth)} · ${word} `
}
