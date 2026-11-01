/** Class recipes for the side panel (side-panel.tsx, panel-tabs.tsx, browser-view.tsx) and the quiet icon buttons it shares with the rail bar. */

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

/** Top left of the page, folded or not: out of the grid's flow, so it stays put while the rail column opens and shuts. */
export const RAIL_BAR = "absolute top-2 left-2 z-7 flex items-center gap-0.5"

/** A frame under the pointer would swallow a resize drag. */
const RESIZING = "[&.is-resizing_iframe]:pointer-events-none"

export const sidePanelClass = (narrow: boolean): string =>
  `side-panel relative row-1 flex min-h-0 min-w-0 flex-col ${RESIZING} ${narrow ? "flex-1 p-0" : "pt-2 pr-1 pb-1 pl-0"}`

/** Tab rows, the divider and the views are cells of one grid: moving a tab changes its cell, so a frame is never re-parented. */
export const SIDE_BODY = `grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] [--divider:5px] *:col-1 ${RESIZING}`

/** Muted words; the one in view is ink. Many tabs scroll sideways; the + stays beside them. */
export const sideHeadClass = (narrow: boolean): string =>
  `side-head flex min-h-6.5 min-w-0 items-center gap-0.5 pb-1.5 font-mono text-meta normal-nums ${narrow ? "px-2 pt-0" : "narrow:px-2 narrow:pt-0"}`

export const PTABS = "scrollbar-none flex min-w-0 flex-1 gap-0.5 overflow-x-auto"

/** Tabs shrink as a browser's do; once they no longer fit (`compact`), only the shown one keeps its name. */
export const ptabClass = (o: { active: boolean; compact: boolean }): string =>
  `group/ptab relative flex max-w-40 items-center hover:text-ink data-[drop=after]:shadow-[inset_-2px_0_0_var(--accent)] data-[drop=before]:shadow-[inset_2px_0_0_var(--accent)] ${o.active ? "is-active text-ink" : "text-muted"} ${o.compact && !o.active ? "min-w-0 flex-none" : "min-w-18 flex-initial"}`

export const ptabMainClass = (iconOnly: boolean): string =>
  `flex min-w-0 cursor-pointer items-center gap-1.5 border-none bg-transparent text-inherit [font:inherit] ${iconOnly ? "px-1.75 py-1" : "py-1 pr-0.5 pl-2"}`

export const PTAB_LABEL = "truncate"

/** Hidden until the tab is hovered or focused; the slot stays so the label never shifts. */
export const PTAB_CLOSE =
  "touch:relative size-4 flex-none cursor-pointer rounded-[4px] border-none bg-transparent p-0 mr-1 font-mono text-title leading-none text-subtle opacity-0 group-hover/ptab:opacity-100 hover:bg-hover hover:text-ink focus-visible:opacity-100 [@media(hover:none)]:opacity-100 touch:after:absolute touch:after:-inset-1.5 touch:after:-left-1 touch:after:content-['']"

/** The top bar's Files / Diff / Browser buttons. */
export const PANEL_LAUNCH = "ml-auto flex gap-0.5"

/** The line between stacked groups: one hairline, a wider strip to grab. */
export const SIDE_DIVIDER =
  "relative row-3 cursor-row-resize touch-none before:absolute before:inset-x-0 before:top-[calc(var(--divider)/2)] before:h-px before:bg-line before:content-[''] hover:before:bg-line-active after:absolute after:inset-x-0 after:-inset-y-0.75 after:content-['']"

/** The views share their group's cell; the hidden ones must beat the flex display. */
export const SIDE_VIEW = "side-view flex min-h-0 min-w-0 flex-col [&[hidden]]:hidden"

export const SIDE_EMPTY =
  "row-2 m-auto flex max-w-[44ch] flex-col items-center gap-2.5 p-4 text-center font-mono text-meta leading-[1.5] text-subtle normal-nums"

export const BROWSER = "flex min-h-0 flex-1 flex-col gap-1.5"
export const BROWSER_BAR = "flex items-center gap-0.5 [&_svg]:flex-none"
/** A plain inset field, no border; an address that was not taken dims. */
export const BROWSER_URL =
  "mx-0.5 min-w-0 flex-1 rounded-sm border-none bg-inset px-2 py-1 text-ink [font-size:var(--fs-meta)] focus:bg-hover focus:outline-none aria-invalid:text-muted"
export const BROWSER_FRAME = "min-w-0 flex-1 rounded-sm border-none bg-[#fff]"
