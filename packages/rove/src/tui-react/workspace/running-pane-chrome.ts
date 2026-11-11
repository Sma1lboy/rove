/**
 * Chrome for the workspace pane while the selected task works: a colour
 * gradient flows around the border, and the top edge names what is running.
 */

import { type OptimizedBuffer, type RGBA, type Renderable, TargetChannel } from "@opentui/core"
import { charWidth } from "../../lib/display-width"
import { flowInk, flowPalette, flowPhase, perimeter } from "../../tui/lib/border-flow"
import { mixInk } from "../../tui/lib/breathe"
import { truncateEndCells } from "../../tui/lib/truncate"

const TITLE_LABEL_CELLS = 32
/** Unfocused panes flow fainter so focus still reads at a glance. */
const UNFOCUSED_SHARE = 0.55
const inkMatrices = new WeakMap<RGBA, Float32Array>()

/** A colour matrix that turns any opaque foreground into `ink`. */
function inkMatrix(ink: RGBA): Float32Array {
  let matrix = inkMatrices.get(ink)
  if (!matrix) {
    const [r, g, b] = ink.toInts()
    matrix = new Float32Array([0, 0, 0, r / 255, 0, 0, 0, g / 255, 0, 0, 0, b / 255, 0, 0, 0, 1])
    inkMatrices.set(ink, matrix)
  }
  return matrix
}

/** `renderAfter` for the pane box: re-inks every border cell from the moving gradient. */
export function runningPaneFlow(accent: RGBA, inactive: RGBA, focused: boolean, tick: number, partnerDeg?: number) {
  const ramp = flowPalette(accent, partnerDeg)
  const palette = focused ? ramp : ramp.map((ink) => mixInk(ink, inactive, UNFOCUSED_SHARE))
  return function paint(this: Renderable, buffer: OptimizedBuffer): void {
    const cells = perimeter(this.width, this.height)
    // A paint hook cannot read the frame, so the border glyphs stay as drawn and only their
    // foreground is recoloured: one mask of cells per ink of the gradient.
    const masks = new Map<RGBA, number[]>()
    cells.forEach(([dx, dy], index) => {
      const x = this.x + dx
      const y = this.y + dy
      if (x < 0 || y < 0 || x >= buffer.width || y >= buffer.height) return
      const ink = flowInk(palette, flowPhase(index, cells.length, tick))
      if (!ink) return
      const mask = masks.get(ink)
      if (mask) mask.push(x, y, 1)
      else masks.set(ink, [x, y, 1])
    })
    for (const [ink, mask] of masks) buffer.colorMatrix(inkMatrix(ink), new Float32Array(mask), 1, TargetChannel.FG)
  }
}

export function runningPaneTitle(label: string, word: string): string {
  return ` ${truncateEndCells(label, TITLE_LABEL_CELLS, charWidth)} · ${word} `
}
