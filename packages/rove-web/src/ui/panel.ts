import { SIDE_PANEL_FRAME } from "./shell.ts"

/** Class recipes for the side panel (side-panel.tsx, panel-column.tsx, panel-tabs.tsx, browser-view.tsx) and the quiet icon buttons it shares with the rail bar. */

/** A stroked 16-unit icon, as the rail's. */
export const STROKE_ICON =
  "flex-none fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.25]"

/**
 * The rail bar's quiet square button, reused by the panel's tools and the browser bar. `tool`: the panel's 22px
 * size; `small`: a 14px icon; `on`: the panel on screen, tinted and past hover.
 */
export const iconButton = (o: { tool?: boolean; small?: boolean; on?: boolean } = {}): string =>
  `relative grid cursor-pointer place-items-center rounded-sm border-none p-0 disabled:cursor-default disabled:opacity-35 [&_svg]:fill-none [&_svg]:stroke-current [&_svg]:[stroke-linecap:round] [&_svg]:[stroke-linejoin:round] [&_svg]:[stroke-width:1.25] touch:after:absolute touch:after:-inset-x-px touch:after:-top-2 touch:after:-bottom-1.25 touch:after:content-[''] touch:first:after:-left-2 ${o.tool ? "size-5.5 flex-none" : "size-6.5"} ${o.tool || o.small ? "[&_svg]:size-3.5" : "[&_svg]:size-4"} ${o.on ? "bg-accent-soft text-accent" : "bg-transparent text-subtle enabled:hover:bg-hover enabled:hover:text-ink"}`

/** Folded: a hidden task needs you. */
export const ICON_BUTTON_DOT = "absolute top-0.75 right-0.75 size-1.5 rounded-full bg-accent"

/** Top left of the page, folded or not: out of the grid's flow, so it stays put while the rail column opens and shuts. Past a desktop shell's traffic lights (`--shell-inset-left`). */
export const RAIL_BAR =
  "absolute top-2 left-[calc(--spacing(2)+var(--shell-inset-left,0px))] z-7 flex items-center gap-0.5"

/** A frame under the pointer would swallow a resize drag. */
const RESIZING = "[&.is-resizing_iframe]:pointer-events-none"

export const sidePanelClass = (narrow: boolean): string =>
  `side-panel ${SIDE_PANEL_FRAME} relative row-1 flex min-h-0 min-w-0 flex-col ${RESIZING} ${narrow ? "flex-1 p-0" : "pt-2 pr-1 pb-1 pl-0"}`

/** Columns and the dividers between them are cells of one grid, placed by `grid-column`: opening or closing one never moves another's DOM node, so a frame is never re-parented. */
export const SIDE_BODY = `grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] [--divider:5px] ${RESIZING}`

/** One kind's column: a slim header over its view. */
export const SIDE_COLUMN = "side-col row-1 flex min-h-0 min-w-0 flex-col"

/** Muted words; the one in view is ink. */
export const sideHeadClass = (narrow: boolean): string =>
  `side-head flex min-h-6.5 min-w-0 items-center gap-0.5 pb-1.5 font-mono text-meta normal-nums ${narrow ? "px-2 pt-0" : "narrow:px-2 narrow:pt-0"}`

/** A column's title in its header. */
export const COLUMN_TITLE = "min-w-0 flex-1 truncate px-2 text-ink"

/** The Browser column's tab strip and its + stay together at the header's left; the buttons keep the right. */
export const PTABS_BOX = "flex min-w-0 flex-1 items-center gap-0.5"

/** Tabs sit tight, as a browser's do. Many scroll sideways; the + stays beside them. */
export const PTABS = "scrollbar-none flex min-w-0 gap-0.5 overflow-x-auto"

/** Tabs are as wide as their name and close slot, up to a cap, and shrink once the row is full; once they no longer fit (`compact`), the others keep a short name (bare icons read as the top bar's launchers) and the row scrolls. */
export const ptabClass = (o: { active: boolean; compact: boolean }): string =>
  `group/ptab relative flex min-w-12 max-w-40 items-center hover:text-ink ${o.active ? "is-active text-ink" : "text-muted"} ${o.compact && !o.active ? "max-w-24 flex-none" : "flex-initial"}`

/** The shown tab keeps its × in line; another tab's × floats over its label's end on hover, so no tab carries an empty slot and tabs sit tight. */
export const ptabMainClass = (active: boolean): string =>
  `flex min-w-0 cursor-pointer items-center gap-1.5 border-none bg-transparent py-1 pl-1.5 text-inherit [font:inherit] ${active ? "pr-0.5" : "pr-1.5"}`

export const PTAB_LABEL = "truncate"

export const ptabCloseClass = (active: boolean): string =>
  `touch:relative size-4 flex-none cursor-pointer rounded-xs border-none p-0 font-mono text-title leading-none text-subtle hover:bg-hover hover:text-ink touch:after:absolute touch:after:-inset-1.5 touch:after:-left-1 touch:after:content-[''] ${active ? "mr-0.5 bg-transparent" : "absolute top-1/2 right-0.5 -translate-y-1/2 bg-paper opacity-0 group-hover/ptab:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"}`

/** The top bar's Files / Diff / Browser buttons. */
export const PANEL_LAUNCH = "ml-auto flex gap-0.5"

/** The line between side-by-side columns: one hairline, a wider strip to grab. */
export const SIDE_DIVIDER =
  "relative row-1 cursor-col-resize touch-none before:absolute before:inset-y-0 before:left-[calc(var(--divider)/2)] before:w-px before:bg-line before:content-[''] hover:before:bg-line-active after:absolute after:inset-x-[-3px] after:inset-y-0 after:content-['']"

/** A column's view; the hidden ones (a Browser's other tabs) must beat the flex display. */
export const SIDE_VIEW = "side-view flex min-h-0 min-w-0 flex-1 flex-col [&[hidden]]:hidden"

/** A column with nothing to show. */
export const SIDE_EMPTY =
  "m-auto flex max-w-[44ch] flex-col items-center gap-2.5 p-4 text-center font-mono text-meta leading-[1.5] text-subtle normal-nums"

export const BROWSER = "flex min-h-0 flex-1 flex-col gap-1.5"
export const BROWSER_BAR = "flex items-center gap-0.5 [&_svg]:flex-none"
/** A plain inset field, no border; an address that was not taken dims. */
export const BROWSER_URL =
  "mx-0.5 min-w-0 flex-1 rounded-sm border-none bg-inset px-2 py-1 text-ink [font-size:var(--fs-meta)] focus:bg-hover focus:outline-none aria-invalid:text-muted"
/** Theme background where the page paints nothing; a light page without a dark scheme still gets the browser's own white backdrop. */
export const BROWSER_FRAME = "min-w-0 flex-1 rounded-sm border-none bg-paper"
