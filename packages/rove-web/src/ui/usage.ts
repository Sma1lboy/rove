/** The Usage page: thin bars as the rail's quota lines draw them, with every section's figures in the same columns. */

/** The page's column: rows this short do not stretch across a wide window. */
export const USG_PAGE = "flex max-w-[46rem] flex-col"

/** Tokens, turns and time end every grid as the same fixed mono columns (5ch, 5ch, 8ch), so the figures line up from one section to the next. */
const GRID = "grid items-center gap-x-3 font-mono text-meta whitespace-nowrap"
/** A day per row: the bar takes the width the date leaves. */
export const USG_DAYS = `${GRID} grid-cols-[6ch_minmax(0,1fr)_5ch_5ch_8ch]`
/** A model or a task per row: on a narrow page the bar gives before the name does. */
export const USG_ROWS = `${GRID} grid-cols-[minmax(8rem,1fr)_minmax(0,10rem)_5ch_5ch_8ch]`
/** A quota window per row: engine, window, fill, percent, pace. */
export const USG_QUOTA = `${GRID} grid-cols-[auto_auto_minmax(2rem,22%)_4ch_minmax(0,1fr)]`

/** A row spans its grid and keeps its columns; the side padding is the hover wash's, pulled back so text stays on the page's edge. */
export const USG_ROW = "col-span-full -mx-2 grid grid-cols-subgrid items-center rounded-sm px-2 py-0.75"
/** A row that opens its task. */
export const USG_ROW_OPEN = `${USG_ROW} cursor-pointer text-left hover:bg-hover focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-focus`

/** A section heading: space before it groups what follows. */
export const USG_HEAD = "mt-5 mb-1.5 flex items-baseline gap-4"
export const USG_LEGEND = "flex flex-wrap gap-x-3 font-sans text-meta text-subtle"
export const USG_SWATCH = "mr-1.5 inline-block size-1.5 rounded-full align-middle"
export const USG_NOTE = "m-0 text-meta text-subtle"

export const USG_LABEL = "min-w-0 truncate"
export const USG_NAME = "min-w-0 truncate font-sans text-ink"
/** A day with no turns, a task that is gone: listed, not read. */
export const USG_QUIET = "text-subtle"
export const USG_FIGURE = "text-right text-muted"

/** The bar's cell, and the bar: `--fill` of the cell wide, never thinner than a dot. */
export const USG_BAR_CELL = "flex min-w-0"
export const USG_BAR = "flex h-1.5 w-(--fill) min-w-1.5 gap-px overflow-hidden rounded-full"
export const USG_SEG = "min-w-0.5 basis-0"
/** One colour per engine, the busiest first; the same engine keeps its colour in every section. */
export const USG_ENGINE_TONES = ["bg-accent", "bg-info", "bg-merged", "bg-subtle"] as const
export const USG_TASK_TONE = "bg-muted"
