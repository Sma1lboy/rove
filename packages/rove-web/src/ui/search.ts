/** The Search page: a field, then one row per conversation hit. */

export const SEARCH_FIELD = "mt-1 mb-1"
export const searchHitClass = (cursor: boolean): string =>
  `flex w-full cursor-pointer flex-col gap-0.5 rounded-sm border-0 bg-transparent px-2.5 py-1.5 text-left text-ink ${cursor ? "bg-inset" : ""}`
export const SEARCH_HIT_HEAD = "flex min-w-0 items-baseline gap-2.5"
export const SEARCH_HIT_TITLE = "min-w-0 flex-1 truncate font-bold"
export const SEARCH_HIT_META = "whitespace-nowrap text-meta text-muted"
export const SEARCH_SNIPPET = "text-meta text-muted [overflow-wrap:anywhere]"
export const SEARCH_MARK = "rounded-xs bg-accent/25 text-ink"
