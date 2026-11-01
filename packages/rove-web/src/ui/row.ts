/**
 * The list row (rail task, file, dialog choice, inbox card) as class recipes: rows render as buttons that carry
 * their own refs, drag and pointer handlers, so they take a class string rather than a wrapper component.
 */

export type RowSize = "row" | "file" | "file-narrow" | "pane"

const SIZE: Readonly<Record<RowSize, string>> = {
  // A fingertip is ~40px: rows grow to it on touch screens.
  row: "min-h-6.5 touch:min-h-10",
  file: "min-h-6 font-mono text-meta touch:min-h-10",
  // The phone's full-panel file list: sized for a finger already.
  "file-narrow": "min-h-9 font-mono text-meta",
  pane: "min-h-5.5 touch:min-h-10",
}

export function rowClass(o: {
  readonly selected?: boolean
  /** Picked up by move mode or a drag: the TUI's move wash. */
  readonly moving?: boolean
  readonly size?: RowSize
  /** Lines stacked top to bottom (an inbox card) instead of one line. */
  readonly stack?: boolean
}): string {
  const layout = o.stack ? "flex-col items-stretch gap-0.5 px-2.5 py-1.5" : "items-center gap-2 px-2 py-0.75"
  const bg = o.moving ? "bg-accent-soft" : o.selected ? "bg-inset" : "hover:bg-hover data-menu-open:bg-hover"
  return `relative flex w-full rounded-sm text-left active:scale-97 motion-reduce:active:scale-none ${layout} ${SIZE[o.size ?? "row"]} ${bg}`
}

/** The row's label: takes the room left and ends in an ellipsis. `row-title` is row-tip.tsx's hook. */
export const ROW_TITLE = "row-title min-w-0 flex-1 truncate"
/** A rail task row's label: sized by its text before the chips take their share, in the title size. */
export const ROW_TITLE_RAIL = "row-title min-w-0 flex-auto truncate text-(length:--fs-title)"

/** A running task row's label under the shimmer pref: a light band sweeps across it, then rests. */
export const ROW_TITLE_RUNNING =
  "running-shimmer:bg-[linear-gradient(90deg,var(--ink)_0%,var(--ink)_35%,var(--accent)_50%,var(--ink)_65%,var(--ink)_100%)] running-shimmer:bg-size-[300%_100%] running-shimmer:bg-clip-text running-shimmer:text-transparent running-shimmer:animate-shimmer"

/** A one-cell mark at a row's start (a status letter, a radio dot). */
export const GLYPH = "w-[1ch] flex-none text-center font-mono"

/** A row's trailing chips. */
export const CHIPS = "flex flex-none gap-1.5 font-mono text-meta"
