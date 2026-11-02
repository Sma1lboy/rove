/** The full pages' shared frame (Kanban, Routines, Issues, Dispatch, Mods) and the rail's page entries. */

/** A full page over the workspace (the TUI's rail pages); a page that lays out its own scrolling adds `overflow-hidden` instead of PAGE_SCROLL. */
export const PAGE =
  "page min-h-0 flex-1 rounded-md border-hairline border-line bg-paper px-4.5 py-3.5 focus:outline-none"
export const PAGE_SCROLL = `${PAGE} overflow-y-auto`
export const PAGE_TITLE = "page-title mx-0 mt-0 mb-1.5 font-sans text-title font-bold normal-nums"

/** Title left, key legend right; the title drops its page margin here. */
export const PG_TOP = "flex items-baseline justify-between gap-4 [&_.page-title]:m-0"
/** The key legend beside a page title; beside `.mono` (a `font:` shorthand) its line height stays normal. */
export const pgHintClass = (mono: boolean): string => `min-w-0 truncate text-meta ${mono ? "" : "leading-[inherit]"}`
export const PG_ACTIONS = "flex flex-wrap items-center gap-2"
/** A link's touch hit area in a page's action row: a row of a list, the Kanban header, or a page header. */
export const PG_ACTION_LINK = {
  row: "touch:after:-inset-x-0.75 touch:after:-inset-y-0.5",
  kanban: "touch:after:-inset-x-0.75 touch:after:-top-1.5 touch:after:-bottom-1",
  header: "touch:after:-inset-x-0.75 touch:after:-top-2.5 touch:after:-bottom-1.25",
} as const
export const PG_LIST = "mt-2.5 flex flex-col gap-1.5"
export const PG_NOTICE = "mx-0 mt-2 mb-0 text-meta leading-[inherit]"

/** Issues */
export const pgIssueClass = (cursor: boolean): string =>
  `flex cursor-pointer flex-col gap-0.5 rounded-sm px-2.5 py-1.5 ${cursor ? "bg-inset" : ""}`
export const PG_ISSUE_LINE = "flex min-w-0 items-baseline gap-2.5"
export const PG_ISSUE_NUM = "whitespace-nowrap text-muted"
export const PG_ISSUE_SUB = "flex gap-2.5 pl-[4ch] text-meta leading-[inherit] text-muted"
export const PG_GROW = "min-w-0 flex-1 truncate"

/** The rail's page entries (New task, Kanban, …) and Settings pinned under the task list. */
export const RAIL_NAV = "flex flex-col px-1.5 pb-2"
export const RAIL_FOOT = "relative flex flex-col px-1.5 pt-1.5 pb-0.5"
/** `:hover` without the hover-capable media gate, as the sheet had: a tap leaves the row washed on a phone. */
export const railNavRowClass = (active: boolean): string =>
  `flex items-center rounded-sm px-2 py-0.75 text-left touch:min-h-10 [&:hover]:bg-inset ${active ? "font-bold text-ink" : "text-muted"}`
/** New task's own +, in the column of the projects' hover +; always shown, in the accent. */
export const RAIL_NAV_PLUS =
  "ml-auto -mr-[6.7px] w-5 text-center font-sans text-display leading-none font-normal text-accent normal-nums"
export const RAIL_NAV_ICON =
  "mr-[7px] size-3.5 flex-none fill-none stroke-current stroke-[1.75] [stroke-linecap:round] [stroke-linejoin:round]"
/** The Settings entry's cue that an engine lacks the Rove agent skill: a small accent dot after the label. */
export const RAIL_NAV_DOT = "ml-1.5 size-1.5 flex-none rounded-full bg-accent"
