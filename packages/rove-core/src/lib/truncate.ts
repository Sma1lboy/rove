/**
 * Ellipsis truncation for compact labels. {@link truncateEnd} keeps the PREFIX
 * (a title/branch's type/scope); {@link truncateStart} keeps the TAIL (a
 * path's leaf disambiguates). The `…Cells` variants use a display-CELL budget.
 *
 * All iterate by code POINT, never UTF-16 unit, so a surrogate pair is never
 * bisected. The code-point variants over-draw on CJK (up to 2× cells), so
 * anything against a hard pane edge (paths, tab titles, toasts, tree rows)
 * must use `…Cells`.
 *
 * Boundary rule: `max <= 0` → `""`; fits → unchanged; else one cell is
 * reserved for the `…`.
 */

/** Truncate keeping the prefix, with a trailing ellipsis when clipped. */
export function truncateEnd(s: string, max: number): string {
  if (max <= 0) return ""
  const points = [...s]
  if (points.length <= max) return s
  return `${points.slice(0, Math.max(0, max - 1)).join("")}…`
}

/**
 * {@link truncateEnd} against a display-CELL budget; `cellsOf` is injected to
 * keep this module dependency-free. No glyph is split across the budget.
 */
export function truncateEndCells(s: string, maxCells: number, cellsOf: (cp: number) => number): string {
  if (maxCells <= 0) return ""
  let total = 0
  for (const ch of s) total += cellsOf(ch.codePointAt(0) ?? 0)
  if (total <= maxCells) return s
  let used = 0
  let out = ""
  for (const ch of s) {
    const w = cellsOf(ch.codePointAt(0) ?? 0)
    if (used + w > maxCells - 1) break // reserve 1 cell for the ellipsis
    used += w
    out += ch
  }
  return `${out}…`
}

/** Truncate keeping the tail, with a leading ellipsis when clipped. */
export function truncateStart(s: string, max: number): string {
  if (max <= 0) return ""
  const points = [...s]
  if (points.length <= max) return s
  return `…${points.slice(points.length - Math.max(0, max - 1)).join("")}`
}

/**
 * {@link truncateStart} against a display-CELL budget. Code points would
 * under-count CJK (`文档/设计/终端渲染说明书笔记.md` is 18 points, 31 cells) and
 * draw through the pane border. Walks from the END; no glyph is split.
 */
export function truncateStartCells(s: string, maxCells: number, cellsOf: (cp: number) => number): string {
  if (maxCells <= 0) return ""
  const points = [...s]
  let total = 0
  for (const ch of points) total += cellsOf(ch.codePointAt(0) ?? 0)
  if (total <= maxCells) return s
  let used = 0
  let out = ""
  for (let i = points.length - 1; i >= 0; i--) {
    const ch = points[i] as string
    const w = cellsOf(ch.codePointAt(0) ?? 0)
    if (used + w > maxCells - 1) break // reserve 1 cell for the ellipsis
    used += w
    out = ch + out
  }
  return `…${out}`
}
