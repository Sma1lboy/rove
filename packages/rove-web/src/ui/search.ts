/** The command palette's task and conversation sections. */

export const SEARCH_HEAD = "mx-1.5 mt-2 mb-0.5 font-mono text-meta font-semibold normal-nums text-subtle first:mt-0"
export const SEARCH_NOTE = "mx-1.5 my-1 text-meta text-muted [overflow-wrap:anywhere]"
export const searchRowClass = (selected: boolean): string =>
  `flex w-full min-w-0 cursor-pointer flex-col gap-0.5 rounded-sm px-1.5 py-1.5 text-left text-ink [font:inherit] touch:py-2.5 ${selected ? "is-selected bg-hover" : ""}`
export const SEARCH_ROW_HEAD = "flex min-w-0 items-baseline gap-2"
export const SEARCH_ROW_TITLE = "min-w-0 flex-1 truncate text-body"
export const SEARCH_ROW_META = "whitespace-nowrap text-meta text-muted"
export const SEARCH_SNIPPET = "text-meta text-muted [overflow-wrap:anywhere]"
export const SEARCH_MARK = "rounded-xs bg-accent/25 text-ink"
