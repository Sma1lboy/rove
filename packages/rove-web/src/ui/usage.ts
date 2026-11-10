/** The Usage page: text-bar rows in the terminal look, one line per day, model or task. */

/** A row of cells: the label first, figures last; nothing wraps, the label gives. */
export const USG_ROW = "flex min-w-0 items-baseline gap-2.5 font-mono text-meta whitespace-nowrap"
/** A row that opens its task. */
export const USG_ROW_OPEN = `${USG_ROW} w-full cursor-pointer border-none bg-transparent p-0 text-left text-inherit [font:inherit] [&:hover]:underline`
export const USG_DAY = "w-[5ch] flex-none text-muted"
/** The bars are accent-coloured glyph runs; a bar that cannot fit is cut, not wrapped. */
export const USG_BAR = "w-[16ch] flex-none overflow-hidden text-accent"
/** A section heading: space before it groups what follows. */
export const USG_HEAD = "mt-3.5 mb-0.5"
export const USG_LABEL = "min-w-0 flex-1 truncate"
const FIGURE = "flex-none text-right text-muted"
export const USG_TOKENS = `${FIGURE} min-w-[5ch]`
export const USG_TURNS = `${FIGURE} min-w-[4ch]`
export const USG_TIME = `${FIGURE} min-w-[5ch]`
/** The per-model bar is a fixed column so the figures line up. */
export const USG_MODEL_BAR = "w-[8ch] flex-none overflow-hidden text-accent"
export const USG_LEGEND = "flex flex-wrap gap-x-3 font-mono text-meta text-muted"
export const USG_NOTE = "m-0 text-meta text-muted"
