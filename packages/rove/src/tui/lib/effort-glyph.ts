/**
 * Reasoning-effort fill glyph: a level's POSITION in its engine's declared
 * `effortLevels` picks a fill from empty (lowest) to full (highest), so the
 * scale needs no vendor's level names. Six fills: a six-level engine gets one
 * each; a seven-level one shares a fill once, and the word beside it tells
 * the two apart.
 */

const FILLS = ["○", "◔", "◑", "◕", "●", "◉"] as const

export type EffortMark = {
  readonly glyph: string
  /** 0 for the engine's lowest level, 1 for its highest. */
  readonly fraction: number
}

/** Null when `levels` doesn't declare `level`: no position, no glyph. */
export function effortMark(levels: readonly string[] | undefined, level: string | undefined): EffortMark | null {
  const index = levels && level ? levels.indexOf(level.trim()) : -1
  if (!levels || index < 0) return null
  const fraction = levels.length > 1 ? index / (levels.length - 1) : 1
  // Halves round DOWN so a middle level lands on the half fill, not past it.
  return { glyph: FILLS[Math.round(fraction * (FILLS.length - 1) - 1e-9)] ?? FILLS[0], fraction }
}

/** `◑ medium`, or the bare level when `levels` doesn't declare it. */
export function effortLabel(levels: readonly string[] | undefined, level: string): string {
  const mark = effortMark(levels, level)
  return mark ? `${mark.glyph} ${level}` : level
}
