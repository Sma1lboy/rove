/**
 * The one mapping from a daemon row status (`rove-daemon/src/daemon/row-status.ts`)
 * to what a rail draws: a glyph from the user's glyph set and a tone. The TUI
 * sidebar, its tab strip and the web rail all call this; none derives a status
 * of its own. No `@/` imports and no i18n, so the web bundles it as is.
 *
 * Tones (the TUI's split): amber for a wait you can clear (a rate limit, a
 * question), red for what stays broken until you act (error, dead engine,
 * a restored session, a failed deletion).
 */

import type { RowStatus } from "@sma1lboy/rove-daemon/daemon/row-status"

export interface RowGlyphSet {
  readonly spinner: readonly string[]
  readonly idle: string
  readonly unseen: string
  readonly needsInput: string
  readonly attention: string
}

export type RowTone = "accent" | "warning" | "error" | "muted"

export interface RowGlyph {
  readonly glyph: string
  readonly tone: RowTone
  /** Animate: the glyph is a spinner frame. */
  readonly spinning: boolean
}

/** A status's tone alone, for a surface that draws its own mark (the web rail's dots). */
export function rowStatusTone(status: RowStatus | undefined): RowTone {
  switch (status?.kind) {
    case "busy":
    case "running":
    case "unseen":
      return "accent"
    case "needs-input":
      return "warning"
    case "attention":
      return status.reason === "rate_limited" ? "warning" : "error"
    default:
      return "muted"
  }
}

export function rowStatusGlyph(status: RowStatus | undefined, glyphs: RowGlyphSet, frame = 0): RowGlyph {
  const tone = rowStatusTone(status)
  switch (status?.kind) {
    case "busy":
    case "running":
      return { glyph: glyphs.spinner[frame % Math.max(1, glyphs.spinner.length)] ?? glyphs.idle, tone, spinning: true }
    case "needs-input":
      return { glyph: glyphs.needsInput, tone, spinning: false }
    case "attention":
      return { glyph: glyphs.attention, tone, spinning: false }
    case "unseen":
      return { glyph: glyphs.unseen, tone, spinning: false }
    default:
      return { glyph: glyphs.idle, tone, spinning: false }
  }
}
