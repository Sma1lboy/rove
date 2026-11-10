/** The side panel's Context tab: one hairline card, a thin segmented bar, a dense legend. */

export const CTX = "scrollbar-none flex min-h-0 flex-1 flex-col overflow-y-auto p-2.5"
export const CTX_EMPTY = "m-0 p-3 font-mono text-meta text-muted"
export const CTX_CARD = "flex flex-col gap-1.5 rounded-sm border-hairline border-line px-3 py-2.5"
export const CTX_TITLE = "m-0 font-sans text-meta font-medium text-ink"
export const CTX_HEAD = "flex items-baseline justify-between gap-3 font-mono text-meta normal-nums"
export const CTX_BAR = "flex h-1 w-full overflow-hidden rounded-full bg-inset"
export const CTX_SEG = "h-full flex-none"
export const CTX_ROWS = "m-0 mt-1 flex list-none flex-col gap-1 p-0"
export const CTX_ROW = "flex min-w-0 items-center gap-2 font-mono text-meta normal-nums"
export const CTX_SWATCH = "size-2 flex-none rounded-xs bg-line"
export const CTX_LABEL = "min-w-0 flex-1 truncate text-muted"
export const CTX_VALUE = "flex-none text-right text-ink"
export const CTX_PCT = "w-[6ch] flex-none text-right text-muted"
export const CTX_NOTE = "m-0 font-mono text-meta text-subtle"
/** A part that lists what it is made of: the row is the summary, the items indent one step under its label. */
export const CTX_FOLD = "group/fold"
export const CTX_SUMMARY = `${CTX_ROW} cursor-pointer list-none [&::-webkit-details-marker]:hidden`
export const CTX_CHEVRON = "flex-none text-subtle group-open/fold:rotate-90"
export const CTX_ITEMS = "m-0 mt-1 flex list-none flex-col gap-1 p-0 pl-4"
export const CTX_ITEM_LABEL = "min-w-0 flex-1 truncate text-subtle"
export const CTX_ITEM_VALUE = "flex-none text-right text-muted"
