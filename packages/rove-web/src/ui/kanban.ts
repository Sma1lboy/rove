/** The Kanban page and the story / routine drawers that share its pickers. */

/** Meta-size text that keeps the line height it inherits; beside `.mono` (a `font:` shorthand) it stays normal. */
const META = "text-meta leading-[inherit]"
const MONO_META = "text-meta"

export const KB_PAGE = "flex flex-col gap-2 overflow-hidden"
export const KB_PROJECT = "flex min-w-0 items-baseline gap-3"
export const KB_PROJECT_NAME =
  "font-bold whitespace-nowrap text-accent touch:relative touch:after:absolute touch:after:-inset-x-2 touch:after:-inset-y-1 touch:after:content-['']"
export const KB_PROJECT_PATH = `min-w-0 truncate ${MONO_META}`
export const KB_EMPTY = `ml-auto ${META}`
export const KB_BOARD = "grid min-h-0 flex-1 grid-cols-4 gap-2"
export const KB_SINGLE = "flex min-h-0 flex-1 flex-col gap-2"
export const KB_STRIP = `flex gap-4 ${MONO_META}`
/** A lane name in the phone's strip: grows down, barely up (lanes sit 16px apart, the project name 8px above). */
export const kbStripTabClass = (active: boolean): string =>
  `touch:relative touch:after:absolute touch:after:-inset-x-1.5 touch:after:-top-1 touch:after:-bottom-3 touch:after:content-[''] ${active ? "font-bold text-accent" : "text-muted"}`

const LANE_TONE = { in_progress: "text-accent", parked: "text-warning", done: "text-success" } as const
export const kbLaneClass = (single: boolean): string =>
  `flex min-h-0 flex-col rounded-md border-hairline border-line p-2 ${single ? "flex-1" : ""}`
export const kbLaneHeadClass = (key: string): string =>
  `m-0 mb-2 flex justify-between gap-2 font-mono text-meta font-bold normal-nums ${LANE_TONE[key as keyof typeof LANE_TONE] ?? "text-muted"}`
export const KB_CARDS = "flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto"
export const KB_CARDS_NOTE = `m-0 ${MONO_META}`

export const kbCardClass = (o: { readonly selected: boolean; readonly attention: boolean }): string =>
  `flex flex-none cursor-pointer flex-col gap-1 rounded-sm border-hairline bg-surface px-2.5 py-2 ${o.selected ? "border-accent" : o.attention ? "border-warning" : "border-line hover:border-line-active"}`
export const KB_CARD_HEAD = "flex justify-between gap-2"
export const kbCardTitleClass = (done: boolean): string => `min-w-0 font-bold wrap-anywhere ${done ? "text-muted" : ""}`
/** Fixed two lines: a stable card whether or not the story has a description. */
export const KB_CARD_BODY = `h-[2.8em] overflow-hidden whitespace-pre-wrap wrap-anywhere ${META}`
export const KB_CARD_FOOT = `flex justify-between gap-2 ${MONO_META}`

/** The drawer is wider than `.dialog.is-wide`. */
export const KB_DRAWER = "w-[min(680px,calc(100vw-32px))]!"
export const KB_DRAWER_HEAD = "flex items-baseline gap-3.5"
export const KB_LABEL = "flex items-baseline gap-2.5"
export const KB_HINT = "tracking-[0] normal-case"
export const KB_BODY = "min-h-40 font-mono"
export const KB_PLACES = "flex flex-col items-start gap-0.5"
/** Keeps the `▸ ` gutter; a phone-width drawer wraps the rest instead of cutting it off. */
export const kbPlaceClass = (active: boolean): string =>
  `text-left font-mono text-meta whitespace-pre-wrap normal-nums ${active ? "font-bold text-accent" : "font-normal text-muted"}`
export const KB_LEGEND = META
export const KB_SECTION = "flex flex-col gap-1 [&_p]:m-0"
export const KB_EVENT = `flex gap-2 ${MONO_META}`
export const KB_AGE = "min-w-[4ch] text-right"
/** A focusable picker group (selector-field.tsx): its frame lights up while it holds the keys. */
export const KB_GROUP = "rounded-sm border-hairline border-transparent p-1 focus:border-accent focus:outline-none"
