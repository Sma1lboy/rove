import { profileSpan, profileTick } from "@/lib/render-profile"
import { type BoxRenderable, FrameBufferRenderable, RGBA, type RenderContext } from "@opentui/core"
import type { TerminalRow } from "../../../tui/panes/terminal/pty-types"
import type { RGB } from "../../../tui/panes/terminal/sgr"
import {
  type TerminalRenderColors,
  chunkCellWidth,
  resolveInverseAttributes,
  sealRowEndAttributes,
  textPresentationRow,
} from "../../../tui/panes/terminal/terminal-render"

type PaintedRow = { source: TerminalRow; cells: FrameBufferRenderable }

const CLEAR = RGBA.fromValues(0, 0, 0, 0)
/** A truecolor gradient names thousands of colors; past this the cache starts over. */
const COLOR_CACHE_MAX = 4096
const colorCache = new Map<number, RGBA>()

function rgba(color: RGB): RGBA {
  const key = (color[0] << 16) | (color[1] << 8) | color[2]
  let value = colorCache.get(key)
  if (!value) {
    if (colorCache.size >= COLOR_CACHE_MAX) colorCache.clear()
    value = RGBA.fromInts(color[0], color[1], color[2])
    colorCache.set(key, value)
  }
  return value
}

/**
 * Retain one cell buffer per terminal row and redraw only the rows that changed. A row is drawn
 * chunk by chunk straight into its cells, at the column xterm gave it; cells no chunk covers stay
 * transparent, so the pane's own background shows through.
 */
export class TerminalRowPainter {
  /** Sparse: a row that has only ever been blank owns no buffer. */
  private rows: (PaintedRow | undefined)[] = []
  private cols = 0
  private colors: TerminalRenderColors | null = null

  constructor(
    private readonly parent: BoxRenderable,
    private readonly context: RenderContext,
  ) {}

  paint(source: readonly TerminalRow[], cols: number, colors: TerminalRenderColors): void {
    if (this.parent.isDestroyed) return
    // A row buffer is exactly `cols` wide, so a new width starts over.
    if (this.cols !== cols) this.dispose()
    const invalidate = this.colors !== colors
    this.cols = cols
    this.colors = colors
    if (cols <= 0) return
    for (let y = 0; y < source.length; y++) {
      const row = source[y]
      if (!row) continue
      let painted = this.rows[y]
      if (painted && painted.source === row && !invalidate) continue
      // An empty row paints nothing (no glyphs, no bg), so a fresh slot needs no buffer.
      if (!painted && row.length === 0) continue
      if (!painted) {
        const cells = new FrameBufferRenderable(this.context, {
          id: `${this.parent.id}-row-${y}`,
          position: "absolute",
          top: y,
          left: 0,
          width: cols,
          // A terminal row occupies exactly one cell in height.
          height: 1,
          respectAlpha: true,
        })
        painted = { source: row, cells }
        this.parent.add(cells)
        this.rows[y] = painted
      }
      painted.source = row
      this.draw(painted.cells, row, cols, colors)
      profileTick("paintRow")
    }
    for (let y = source.length; y < this.rows.length; y++) this.release(this.rows[y])
    if (this.rows.length > source.length) this.rows.length = source.length
  }

  private draw(cells: FrameBufferRenderable, row: TerminalRow, cols: number, colors: TerminalRenderColors): void {
    const chunks = profileSpan("styled", () => {
      const resolved = resolveInverseAttributes([textPresentationRow(row)], colors.foreground, colors.background)
      return sealRowEndAttributes(resolved, cols, colors.foreground, colors.background)[0] ?? []
    })
    const buffer = cells.frameBuffer
    buffer.clear(CLEAR)
    const fg = rgba(colors.foreground)
    let x = 0
    for (const chunk of chunks) {
      if (x >= cols) break
      buffer.drawText(
        chunk.text,
        x,
        0,
        chunk.fg ? rgba(chunk.fg) : fg,
        chunk.bg ? rgba(chunk.bg) : undefined,
        chunk.attributes ?? 0,
      )
      x += chunkCellWidth(chunk.text)
    }
    cells.requestRender()
  }

  private release(row: PaintedRow | undefined): void {
    if (!row || row.cells.isDestroyed) return
    if (!this.parent.isDestroyed) this.parent.remove(row.cells)
    row.cells.destroy()
  }

  dispose(): void {
    for (const row of this.rows) this.release(row)
    this.rows = []
  }
}
