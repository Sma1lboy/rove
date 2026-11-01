/** Settings rows and the Engines list. A bare `font-size` in the old sheet kept the parent's line-height: `leading-[inherit]`. */

const PREF = "-mx-1 flex w-[calc(100%+8px)] items-baseline gap-2.5 px-1 py-1.25 text-left text-body leading-[inherit]"
/** A label row (a switch, a number): the 4px inset is for the hover wash, so the row bleeds it out and its text keeps the fields' edge. */
export const PREF_ROW = `${PREF} cursor-pointer`
/** A row that moves to its next value on click. */
export const PREF_CYCLE = `${PREF} enabled:hover:bg-hover`
export const PREF_READONLY = PREF
export const PREF_CHECKBOX = "self-center accent-accent"
export const PREF_LABEL = "text-meta leading-[inherit]"
/** A CJK label beside a hint can break after any character; the hint must not squeeze it to one. */
export const PREF_LABEL_BESIDE_HINT = `${PREF_LABEL} max-w-2/5 shrink-0`
/** The label of a cycling row, with its chevron. */
export const PREF_CYCLE_LABEL = `${PREF_LABEL} after:ml-1.5 after:inline-block after:size-2.5 after:bg-subtle after:align-[-1px] after:content-[''] after:chevron-mask`
export const PREF_HINT = "m-0 text-meta leading-[inherit]"
/** A `.mono` label: its `font` shorthand set line-height back to normal. */
export const PREF_LABEL_MONO = "text-meta"
/** Paths and binding ids have no spaces: they break anywhere rather than widen the section. */
export const PREF_FIELD = "m-0 flex min-w-0 flex-col gap-1.5 border-none border-current px-0 py-1 [&_p]:wrap-anywhere"
export const PREF_LEGEND = `${PREF_LABEL} float-left mb-1.5 w-full p-0`
export const PREF_NUMBER = "w-[9ch] px-1.5 py-0.75"

export const TIER_ROW = "flex flex-col gap-0.75 border-b-hairline border-b-line px-1 py-2"
export const TIER_HEAD = "flex items-baseline gap-3"
export const TIER_EDITOR = "flex flex-col gap-2 pt-2 pb-0.5"

/** An inline yes/no under a row (reset, restart, disconnect). */
export const CONFIRM_INLINE =
  "flex flex-col gap-1.5 rounded-sm border-hairline border-line bg-inset px-2.5 py-2 [&_p]:m-0"

const ENG_GRID = "grid grid-cols-[minmax(0,1fr)_104px_72px] items-center gap-3"
export const ENG_LIST = "flex flex-col"
export const ENG_LIST_HEAD = `${ENG_GRID} border-b-hairline border-b-line pt-0 pr-1 pb-1.5 pl-7.5 font-sans text-meta font-medium normal-nums text-subtle [&>span:not(:first-child)]:text-center`
export const ENG_ITEM = "border-b-hairline border-b-line"
/** `group/eng`: the make-default button shows while its row is hovered or focused. */
export const ENG_ROW = `${ENG_GRID} group/eng rounded-sm py-1 pr-1 pl-0 hover:bg-hover`
const FOCUS = "focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-focus"
export const ENG_SUMMARY = `flex min-w-0 items-center gap-2 rounded-sm py-1.5 pr-0 pl-1.5 text-left ${FOCUS}`
export const engChevronClass = (open: boolean): string => `mx-0.5 ${open ? "text-muted" : "text-subtle"}`
export const ENG_TITLE = "flex min-w-0 flex-col gap-0.5"
export const engNameClass = (off: boolean): string =>
  `truncate text-body leading-[inherit] font-medium ${off ? "text-muted" : "text-ink"}`
export const ENG_SUB = "ml-2 text-meta leading-[inherit] font-normal text-subtle"

export type EngTone = "ready" | "attention" | "error" | "absent"
const DOT: Record<EngTone, string> = {
  ready: "bg-success",
  attention: "bg-warning",
  error: "bg-error",
  absent: "bg-subtle",
}
export const engStatusClass = (tone: EngTone): string =>
  `inline-flex items-center gap-1.5 text-meta leading-[inherit] ${tone === "error" ? "text-error" : "text-muted"}`
export const engDotClass = (tone: EngTone): string => `size-1.75 flex-none rounded-full ${DOT[tone]}`

export const ENG_DEFAULT = "flex justify-center"
export const ENG_PILL =
  "rounded-full bg-accent-soft px-2.25 py-0.5 font-sans text-meta font-medium normal-nums capitalize text-accent"
export const ENG_MAKE_DEFAULT =
  "rounded-full border-hairline border-line px-2.25 py-0.5 text-meta leading-[inherit] whitespace-nowrap text-muted opacity-0 transition-opacity duration-120 ease-[ease] group-hover/eng:opacity-100 group-focus-within/eng:opacity-100 hover:border-line-active hover:text-ink motion-reduce:transition-none touch:opacity-100"

export const ENG_DETAIL_AREA = "mt-0 mr-1 mb-2.5 ml-7 flex flex-col gap-2.5 rounded-sm bg-inset px-3 py-2.5"
export const ENG_FACTS = "m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3.5 gap-y-1.5 text-meta leading-[1.5]"
export const ENG_FACT_TERM = "text-subtle"
export const engFactClass = (warn: boolean): string => `m-0 wrap-anywhere ${warn ? "text-warning" : "text-ink"}`
export const ENG_ACTIONS = "flex items-center gap-2"
export const ENG_RENAME_INPUT = "flex-1 px-2 py-1.25"
export const ENG_ACTION = `rounded-sm border-hairline border-line px-2.5 py-1 text-meta leading-[inherit] text-ink hover:border-line-active hover:bg-hover touch:min-h-10 ${FOCUS}`

/** A boxed section under the list: integrations, the agent skill. */
export const ENG_BOX = "mt-1.5 flex flex-col gap-1.5 rounded-md border-hairline border-line px-3.5 py-3"
export const ENG_BOX_HEAD = "flex items-baseline gap-2.5"
export const ENG_BOX_TITLE = "m-0 text-body leading-[inherit] font-medium"
export const ENG_BOX_ACTIONS = `${ENG_ACTIONS} mt-1`
export const ENG_BOX_BUTTON = "px-3 py-1.25 font-sans text-meta font-medium normal-nums"
export const ENG_UPTODATE = "text-meta leading-[inherit] text-success"

/** Settings: the section list beside the section; on a phone the list becomes a row above it. */
export const SETTINGS =
  "grid min-h-90 grid-cols-[140px_1fr] gap-4.5 w-narrow:min-h-0 w-narrow:grid-cols-[minmax(0,1fr)] w-narrow:gap-3"
export const SETTINGS_NAV =
  "flex flex-col gap-0.5 pr-2.5 [border-right:var(--hairline)_solid_var(--line)] w-narrow:flex-row w-narrow:overflow-x-auto w-narrow:scrollbar-none w-narrow:[border-right:none] w-narrow:[border-bottom:var(--hairline)_solid_var(--line)] w-narrow:p-0 w-narrow:pb-2"
/** The active tab keeps its inset under the pointer, as `.is-active` outranked `:hover`. */
export const settingsTabClass = (active: boolean): string =>
  `rounded-sm px-2.5 py-1.25 text-left w-narrow:flex-none w-narrow:whitespace-nowrap ${active ? "bg-inset text-ink" : "text-muted [&:hover]:bg-hover"}`
/** The padding leaves room for a focus ring the scroller would clip, so headings and fields share one left edge. */
export const SETTINGS_BODY = "flex max-h-[60vh] flex-col gap-4.5 overflow-y-auto px-1.5"
export const SETTINGS_GROUP = "flex flex-col gap-2 [&_p]:m-0 [&_p]:text-[length:var(--fs-meta)]"
export const SETTINGS_ROWS = "flex flex-col"
export const ENGINE_ROW = "flex items-center gap-2.5 border-b-hairline border-b-line px-1 py-1.5"
export const ENGINE_MAIN = "flex min-w-0 flex-1 flex-col gap-0.5"
/** One line, cut with an ellipsis; `wrap` lets a description run onto more lines. */
export const engineDetailClass = (wrap = false): string =>
  `overflow-hidden text-ellipsis text-[length:var(--fs-meta)] ${wrap ? "whitespace-normal" : "whitespace-nowrap"}`
