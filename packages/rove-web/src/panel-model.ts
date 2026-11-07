/**
 * A task's side panel as plain data: side-by-side columns, one per kind of view, left to right in the
 * order they were opened. Only the Browser column has tabs (`browser-tabs.ts`). Every function returns
 * the next panel and leaves the one it was given alone; `panel-state.ts` stores them,
 * `panel-storage.ts` reads them back and `side-panel.tsx` draws them.
 */

import { type BrowserColumn, blankBrowser, openUrl } from "./browser-tabs.ts"
import type { PanelKind } from "./panel-layout.ts"

/** `working` = uncommitted, `branch` = committed since the base, `task` = both. */
export type DiffScope = "working" | "branch" | "task"

export type Column =
  | { readonly kind: "files" | "chat" | "quota" }
  | { readonly kind: "diff"; readonly path: string; readonly scope: DiffScope }
  | BrowserColumn

export interface TaskPanel {
  /** Open order, left to right; at most one per kind. */
  readonly columns: readonly Column[]
  /** Share of the width per kind; a kind without one (just opened) takes the mean of the others. */
  readonly weights: Readonly<Partial<Record<PanelKind, number>>>
}

/** No column is narrower than this when a divider is dragged. */
export const COLUMN_MIN_PX = 220
/** What `columnWeights` adds up to. */
const WEIGHT_TOTAL = 1000

/** A task never seen: Files alone. */
export function newPanel(): TaskPanel {
  return { columns: [{ kind: "files" }], weights: {} }
}

export function columnOf(panel: TaskPanel, kind: PanelKind): Column | undefined {
  return panel.columns.find((col) => col.kind === kind)
}

export function diffName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1)
}

function replaceColumn(panel: TaskPanel, col: Column): TaskPanel {
  return { ...panel, columns: panel.columns.map((c) => (c.kind === col.kind ? col : c)) }
}

/** A view by kind alone (`--view files`, the phone's switch, a launcher): its column, opened on the right if closed. */
export function showKind(panel: TaskPanel, kind: PanelKind): TaskPanel {
  if (columnOf(panel, kind)) return panel
  const col: Column =
    kind === "diff" ? { kind, path: ".", scope: "working" } : kind === "browser" ? blankBrowser() : { kind }
  return { ...panel, columns: [...panel.columns, col] }
}

/** A file's diff (`.` = the whole worktree): the Diff column, retargeted if it is open. */
export function showDiff(panel: TaskPanel, path: string, scope: DiffScope): TaskPanel {
  const col: Column = { kind: "diff", path, scope }
  const open = columnOf(panel, "diff")
  if (!open) return { ...panel, columns: [...panel.columns, col] }
  return open.kind === "diff" && open.path === path && open.scope === scope ? panel : replaceColumn(panel, col)
}

/** An address: the Browser tab already on it, else a blank one, else a new tab; the column opens if closed. */
export function showBrowser(panel: TaskPanel, url: string): TaskPanel {
  const open = columnOf(panel, "browser")
  if (open?.kind === "browser") return replaceColumn(panel, openUrl(open, url))
  return { ...panel, columns: [...panel.columns, openUrl(blankBrowser(), url)] }
}

/** Closing a column forgets what it held (a diff's file, a Browser's tabs) and its share of the width. */
export function closeColumn(panel: TaskPanel, kind: PanelKind): TaskPanel {
  if (!columnOf(panel, kind)) return panel
  const { [kind]: _gone, ...weights } = panel.weights
  return { columns: panel.columns.filter((col) => col.kind !== kind), weights }
}

/** Edits the Browser column; a null result (its last tab closed) closes the column. */
export function editBrowser(panel: TaskPanel, edit: (col: BrowserColumn) => BrowserColumn | null): TaskPanel {
  const open = columnOf(panel, "browser")
  if (open?.kind !== "browser") return panel
  const next = edit(open)
  if (next === open) return panel
  return next ? replaceColumn(panel, next) : closeColumn(panel, "browser")
}

/**
 * A launcher button toggles its own column. `visible`: the panel is on screen. Pressed on a column that
 * is showing, it closes that column (the panel goes with its last one); otherwise it opens it.
 */
export function launch(panel: TaskPanel, visible: boolean, kind: PanelKind): { panel: TaskPanel; open: boolean } {
  if (visible && columnOf(panel, kind)) {
    const next = closeColumn(panel, kind)
    return { panel: next, open: next.columns.length > 0 }
  }
  return { panel: showKind(panel, kind), open: true }
}

/** Each column's share of the panel, in column order, adding up to `WEIGHT_TOTAL`. */
export function columnWeights(panel: TaskPanel): number[] {
  const given = panel.columns.flatMap((col) => {
    const w = panel.weights[col.kind]
    return w !== undefined && w > 0 ? [w] : []
  })
  const mean = given.length > 0 ? given.reduce((a, b) => a + b, 0) / given.length : 1
  const raw = panel.columns.map((col) => panel.weights[col.kind] || mean)
  const sum = raw.reduce((a, b) => a + b, 0)
  return raw.map((w) => (w / sum) * WEIGHT_TOTAL)
}

/** Pixel widths in column order, as measured: keep them as the shares. */
export function setWidths(panel: TaskPanel, widths: readonly number[]): TaskPanel {
  const total = widths.reduce((a, b) => a + b, 0)
  if (widths.length !== panel.columns.length || !(total > 0)) return panel
  const weights = Object.fromEntries(
    panel.columns.map((col, i) => [col.kind, Math.round(((widths[i] as number) / total) * 1000) / 1000]),
  )
  const same = panel.columns.every((col) => Math.abs((panel.weights[col.kind] ?? 0) - (weights[col.kind] ?? 0)) < 0.001)
  return same ? panel : { ...panel, weights }
}

/** Equal shares again. */
export function resetWidths(panel: TaskPanel): TaskPanel {
  return Object.keys(panel.weights).length === 0 ? panel : { ...panel, weights: {} }
}

/** A divider between column `index` and the next, dragged by `delta` px: only those two change, neither under `min`. */
export function moveDivider(widths: readonly number[], index: number, delta: number, min: number): number[] {
  const left = widths[index]
  const right = widths[index + 1]
  if (left === undefined || right === undefined) return [...widths]
  const pair = left + right
  const floor = Math.min(min, pair / 2)
  const next = Math.max(floor, Math.min(pair - floor, left + delta))
  return widths.map((w, i) => (i === index ? next : i === index + 1 ? pair - next : w))
}
