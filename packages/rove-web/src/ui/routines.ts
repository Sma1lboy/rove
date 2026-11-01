/** The Routines page: a grouped list beside the selected routine, each column scrolling on its own. */

/** Under 720px of page width the two columns stack and the body scrolls (`rt-narrow`, tailwind.css). */
export const RT_PAGE = "flex flex-col overflow-hidden @container"
export const RT_BODY =
  "mt-2.5 grid min-h-0 flex-1 grid-cols-[minmax(260px,2fr)_minmax(0,3fr)] gap-4 rt-narrow:flex rt-narrow:flex-col rt-narrow:overflow-y-auto"
/** A rail-like list: its bar is hidden, as the rail's is. */
export const RT_LIST =
  "flex min-h-0 flex-col gap-3 overflow-y-auto scrollbar-none rt-narrow:shrink-0 rt-narrow:overflow-visible"
export const RT_GROUP = "flex gap-1.5 px-2 pt-0 pb-1"
/** The rail's own pair: a neutral wash on hover (ungated, as the sheet had), the inset fill for the selected row. */
export const rtRowClass = (cursor: boolean): string =>
  `flex min-w-0 cursor-pointer flex-col gap-0.5 rounded-sm px-2 py-1.5 ${cursor ? "bg-inset" : "[&:hover]:bg-hover"}`
export const RT_ROW_LINE = "flex min-w-0 items-baseline gap-2.5"
export const rtNameClass = (off: boolean): string => `min-w-0 flex-1 truncate font-bold ${off ? "text-muted" : ""}`
export const RT_WHEN = "whitespace-nowrap text-meta"
export const RT_ROW_SUB = "truncate text-meta"
/** Beside the list, split by one hairline: no card inside the page's card. Its blocks keep their height. */
export const RT_DETAIL =
  "flex min-h-0 flex-col gap-1.5 overflow-y-auto py-0 pr-0 pl-4 [border-left:var(--hairline)_solid_var(--line)] [&_h2]:m-0 [&_p]:m-0 [&>*]:shrink-0 [&>h2]:mt-2.5 rt-narrow:shrink-0 rt-narrow:overflow-visible rt-narrow:pt-3 rt-narrow:pl-0 rt-narrow:[border-left:none] rt-narrow:[border-top:var(--hairline)_solid_var(--line)]"
export const RT_HEAD = "flex flex-wrap items-baseline justify-between gap-3"
export const RT_NAME = "font-sans text-display font-bold normal-nums wrap-anywhere"
export const RT_META =
  "mx-0 mt-1 mb-0 grid grid-cols-[max-content_minmax(0,1fr)] items-baseline gap-x-3.5 gap-y-1 [&_dd]:m-0 [&_dd]:wrap-anywhere [&_dd_.mono]:whitespace-pre"
export const RT_PROMPT =
  "max-h-[12lh] overflow-y-auto rounded-sm bg-inset px-2.5 py-2 whitespace-pre-wrap wrap-anywhere"

/** Recent runs and responses. */
export const RT_RUN = "min-w-0 text-meta leading-[inherit]"
const RUN_LINE = "flex w-full min-w-0 gap-2 text-inherit"
export const RT_RUN_LINE = RUN_LINE
/** A run that made a session opens it: a bare button, underlined on hover. */
export const RT_RUN_OPEN = `${RUN_LINE} cursor-pointer border-none bg-transparent p-0 text-left font-[inherit] [&:hover]:underline`
export const RT_GROW = "min-w-0 flex-1 truncate"
export const RT_RUN_ERROR =
  "pl-[calc(2ch+16px)] [&_summary]:cursor-pointer [&_summary]:list-none [&_summary]:truncate [&_summary::-webkit-details-marker]:hidden [&[open]_summary]:whitespace-normal [&_pre]:mx-0 [&_pre]:mt-1 [&_pre]:mb-1.5 [&_pre]:max-h-[16lh] [&_pre]:overflow-auto [&_pre]:rounded-sm [&_pre]:bg-inset [&_pre]:px-2 [&_pre]:py-1.5 [&_pre]:whitespace-pre-wrap [&_pre]:wrap-anywhere [&_pre]:text-muted"
export const RT_RESPONSE = "[&+&]:mt-1.5"
/** A response's text; beside `.mono` (a `font:` shorthand) its line height stays normal. */
export const rtResponseClass = (mono: boolean): string =>
  `whitespace-pre-wrap wrap-anywhere text-meta ${mono ? "" : "leading-[inherit]"}`
export const RT_RUN_HEAD = "text-meta"

/** The composer's schedule cells (padding from the SelectorField frame), and the steppers a soft keyboard (no arrows) gets instead. */
export const RT_CRON = "flex gap-4.5"
export const rtCronCellClass = (active: boolean): string =>
  `flex min-w-[5ch] flex-col gap-0.5 rounded-sm border-hairline px-1.5 py-1 text-left font-mono text-body normal-nums [&>span]:text-meta [&>span]:text-subtle ${active ? "border-accent font-bold text-accent" : "border-transparent font-normal"}`
export const RT_CRON_STEP = "hidden gap-2 px-1 pt-0.5 pb-1.5 touch:flex"
export const RT_CRON_STEP_BUTTON =
  "h-8 w-11 touch-manipulation rounded-sm border-hairline border-line bg-inset font-mono text-display font-normal normal-nums text-ink"
