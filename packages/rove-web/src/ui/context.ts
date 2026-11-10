/** The side panel's Context column: the headline, a thin segmented bar, then one aligned row per part. */

export const CTX = "scrollbar-none flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3"
export const CTX_EMPTY = "m-0 p-3 font-mono text-meta text-muted"
export const CTX_HEAD = "flex items-baseline justify-between gap-3 font-mono text-meta normal-nums"
export const CTX_BAR = "flex h-1.5 w-full gap-px overflow-hidden rounded-full bg-inset"
/** 2px floor: a part under 1% of the window still shows as a segment. */
export const CTX_SEG = "h-full min-w-[2px] flex-none"
export const CTX_ROWS = "m-0 flex list-none flex-col p-0"
/** Rows bleed 4px past the text edge, so a hover wash has room and the text still lines up with the bar. */
export const CTX_ROW = "-mx-1 flex h-5.5 min-w-0 items-center gap-2 rounded-xs px-1 font-mono text-meta normal-nums"
export const CTX_GAP = "mt-2"
export const CTX_SWATCH = "size-2 flex-none rounded-full bg-line"
export const CTX_NAME = "flex min-w-0 flex-1 items-center gap-1.5"
export const CTX_LABEL = "min-w-0 truncate text-muted"
export const CTX_VALUE = "w-[7ch] flex-none text-right text-ink"
export const CTX_PCT = "w-[6ch] flex-none text-right text-muted"
export const CTX_NOTE = "m-0 font-mono text-meta text-subtle"
/** A part that lists what it is made of: the row opens it, the items sit under its label. */
export const CTX_FOLD = "group/fold"
export const CTX_SUMMARY = `${CTX_ROW} cursor-pointer list-none hover:bg-hover focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus [&::-webkit-details-marker]:hidden`
export const CTX_CHEVRON = "inline-block flex-none text-subtle group-open/fold:rotate-90"
export const CTX_ITEMS = "m-0 flex list-none flex-col p-0"
export const CTX_ITEM = `${CTX_ROW} pl-5`
export const CTX_ITEM_NAME = "flex min-w-0 flex-1 overflow-hidden"
export const CTX_ITEM_DIR = "min-w-0 truncate text-subtle"
export const CTX_ITEM_LEAF = "flex-none text-muted"
export const CTX_ITEM_VALUE = "w-[7ch] flex-none text-right text-muted"
/** Holds the percent column open under a part's own percent. */
export const CTX_ITEM_PAD = "w-[6ch] flex-none"
