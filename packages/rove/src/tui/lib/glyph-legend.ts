/**
 * The help dialog's mark legend: which surface draws each `GlyphSet` mark,
 * in reading order. Keyed by every `GlyphSet` field, so a new mark fails
 * `tsc` until it is placed here or deliberately left out with `null`.
 */

import type { GlyphSet } from "./glyphs"

export type GlyphLegendGroup = "rows" | "inbox" | "pr"

export type GlyphLegendMark = keyof GlyphSet

/** Theme color the surface draws the mark in. */
export type GlyphLegendTone = "primary" | "warning" | "error" | "success" | "textMuted"

type Placement = readonly [GlyphLegendGroup, GlyphLegendTone]

const PLACEMENT: Readonly<Record<GlyphLegendMark, Placement | null>> = {
  spinner: ["rows", "primary"],
  needsInput: ["rows", "warning"],
  attention: ["rows", "error"],
  unseen: ["rows", "primary"],
  idle: ["rows", "textMuted"],
  subagent: ["rows", "textMuted"],
  remote: ["rows", "textMuted"],
  done: ["inbox", "success"],
  rateLimited: ["inbox", "warning"],
  dead: ["inbox", "error"],
  routineFailed: ["inbox", "error"],
  conflict: ["pr", "error"],
  checksFailing: ["pr", "error"],
  checksPassing: ["pr", "success"],
  // Only ever drawn beside a word that names it.
  running: null,
}

const GROUP_ORDER: readonly GlyphLegendGroup[] = ["rows", "inbox", "pr"]

export interface GlyphLegendRow {
  readonly mark: GlyphLegendMark
  readonly glyph: string
  readonly tone: GlyphLegendTone
}

export interface GlyphLegendSection {
  readonly group: GlyphLegendGroup
  readonly rows: readonly GlyphLegendRow[]
}

/** The legend in `glyphs`' own marks; a spinner shows its first frame. */
export function glyphLegendSections(glyphs: GlyphSet): GlyphLegendSection[] {
  const marks = Object.keys(PLACEMENT) as GlyphLegendMark[]
  return GROUP_ORDER.map((group) => ({
    group,
    rows: marks.flatMap((mark) => {
      const placement = PLACEMENT[mark]
      if (placement?.[0] !== group) return []
      const value = glyphs[mark]
      return [{ mark, glyph: typeof value === "string" ? value : (value[0] ?? ""), tone: placement[1] }]
    }),
  }))
}
