/** The terminal's fit: every column the host has, the scrollbar floating over the last one. */

import { FitAddon, type ITerminalDimensions } from "@xterm/addon-fit"
import type { Terminal } from "@xterm/xterm"

type RenderDimensions = { readonly css: { readonly cell: { readonly width: number } } }

/**
 * addon-fit 0.11 keeps the scrollbar's lane (`overviewRuler.width`) free of text, but xterm 6 draws its slider as
 * an overlay that fades in on hover and scroll: the lane is a dead column. This fit gives it to the text.
 */
export class OverlayFitAddon extends FitAddon {
  constructor(private readonly term: Terminal) {
    super()
  }

  override proposeDimensions(): ITerminalDimensions | undefined {
    const dims = super.proposeDimensions()
    const el = this.term.element
    const host = el?.parentElement
    // The same private read addon-fit makes for the cell size.
    const cell = (this.term as unknown as { _core?: { _renderService?: { dimensions?: RenderDimensions } } })._core
      ?._renderService?.dimensions?.css.cell.width
    if (!dims || !el || !host || !cell) return dims
    const style = getComputedStyle(el)
    const width =
      Number.parseInt(getComputedStyle(host).width) -
      Number.parseInt(style.paddingLeft) -
      Number.parseInt(style.paddingRight)
    return { cols: Math.max(dims.cols, Math.floor(width / cell)), rows: dims.rows }
  }
}
