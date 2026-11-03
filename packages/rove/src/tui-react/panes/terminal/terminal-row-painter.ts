import { profileSpan, profileTick } from "@/lib/render-profile"
import { type BoxRenderable, RGBA, type RenderContext, StyledText, TextRenderable } from "@opentui/core"
import type { TerminalRow } from "../../../tui/panes/terminal/pty-types"
import { rowsToStyledText } from "../../../tui/panes/terminal/sgr-to-text-chunk"
import {
  type TerminalRenderColors,
  resolveInverseAttributes,
  sealRowEndAttributes,
  textPresentationRow,
} from "../../../tui/panes/terminal/terminal-render"

type PaintedRow = { source: TerminalRow; text: TextRenderable }

/** Retain one text buffer per terminal row. Grid coordinates avoid text-flow
 * layout shifting the cursor; selection continues to use the PTY snapshot. */
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
    const invalidate = this.cols !== cols || this.colors !== colors
    this.cols = cols
    this.colors = colors
    for (let y = 0; y < source.length; y++) {
      const row = source[y]
      if (!row) continue
      let painted = this.rows[y]
      if (painted && painted.source === row && !invalidate) continue
      // An empty row paints nothing (no glyphs, no bg), so a fresh slot needs no buffer.
      if (!painted && row.length === 0) continue
      const content = profileSpan("styled", () => {
        const resolved = resolveInverseAttributes([textPresentationRow(row)], colors.foreground, colors.background)
        const sealed = sealRowEndAttributes(resolved, cols, colors.foreground, colors.background)
        return new StyledText(rowsToStyledText(sealed))
      })
      if (!painted) {
        const text = new TextRenderable(this.context, {
          id: `${this.parent.id}-row-${y}`,
          position: "absolute",
          top: y,
          left: 0,
          right: 0,
          // A terminal row occupies exactly one cell in height.
          height: 1,
          wrapMode: "none",
          selectable: false,
          fg: RGBA.fromInts(...colors.foreground),
          content,
        })
        painted = { source: row, text }
        this.parent.add(text)
        this.rows[y] = painted
      } else {
        if (invalidate) painted.text.fg = RGBA.fromInts(...colors.foreground)
        painted.text.content = content
        painted.source = row
      }
      profileTick("paintRow")
    }
    for (let y = source.length; y < this.rows.length; y++) {
      const row = this.rows[y]
      if (row && !row.text.isDestroyed) {
        this.parent.remove(row.text)
        row.text.destroy()
      }
    }
    if (this.rows.length > source.length) this.rows.length = source.length
  }

  dispose(): void {
    for (const row of this.rows) {
      if (!row || row.text.isDestroyed) continue
      if (!this.parent.isDestroyed) this.parent.remove(row.text)
      row.text.destroy()
    }
    this.rows = []
  }
}
