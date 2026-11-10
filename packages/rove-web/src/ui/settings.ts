/**
 * Settings: a dialog holding a grouped section list beside one section, its rows, and the sections' own parts.
 * One type rule: sans for every word the user reads; mono only for paths, commands, chords and codes.
 */
import { OVERLAY } from "./overlay.ts"

/** On a phone the dialog is the whole screen. */
export const SETTINGS_OVERLAY = `${OVERLAY} w-narrow:pt-0`
/** A fixed height, so switching sections never moves the box; the section scrolls inside it. */
export const SETTINGS_DIALOG =
  "dialog relative m-0 flex h-[min(640px,80vh)] w-[min(880px,calc(100vw-32px))] overflow-hidden rounded-md border-hairline border-line bg-surface text-inherit shadow-dialog focus:outline-none motion-safe:animate-rise-in [.is-leaving_&]:animate-sink-out w-narrow:h-dvh w-narrow:w-screen w-narrow:flex-col w-narrow:rounded-none w-narrow:border-0 w-narrow:pt-[env(safe-area-inset-top)] w-narrow:pb-[env(safe-area-inset-bottom)] short:h-[calc(100dvh-24px)]"
export const SETTINGS_CLOSE =
  "absolute top-3 right-3 z-1 grid size-7 place-items-center rounded-sm text-display leading-none text-muted hover:bg-inset hover:text-ink focus-visible:bg-inset focus-visible:text-ink touch:size-10"
/** A phone's way from an open section back to the list. */
export const SETTINGS_BACK =
  "hidden flex-none items-center px-4 py-3 pr-12 text-left font-mono text-meta font-bold text-accent w-narrow:flex touch:min-h-11"

export const SETTINGS_NAV =
  "flex w-56 flex-none flex-col gap-5 overflow-y-auto scrollbar-none [border-right:var(--hairline)_solid_var(--line)] px-2.5 py-4 w-narrow:w-full w-narrow:flex-1 w-narrow:[border-right:none] w-narrow:px-3 w-narrow:py-3"
export const SETTINGS_NAV_TITLE = "m-0 px-2 pb-0.5 font-sans text-title font-semibold normal-nums text-ink"
export const SETTINGS_NAV_GROUP = "flex flex-col gap-0.5"
/** A group's name above its sections: small mono and faint, so it never reads as one more section. */
export const SETTINGS_NAV_LABEL = "m-0 px-2 pb-1 font-mono text-meta font-normal text-subtle"
/** Sections in ink, the group names under them faint; the quiet group (About, Feedback, Dev) reads a step lighter. */
export const settingsNavItemClass = (active: boolean, quiet: boolean): string =>
  `flex items-center rounded-sm px-2 py-1.25 text-left font-sans text-body touch:min-h-10 w-narrow:min-h-11 w-narrow:px-3 ${
    active ? "bg-menu text-ink" : `${quiet ? "text-muted" : "text-ink"} [&:hover]:bg-hover`
  }`
export const SETTINGS_NAV_CHEVRON = "ml-auto hidden text-subtle w-narrow:block"

export const SETTINGS_SCROLL = "min-h-0 min-w-0 flex-1 overflow-y-auto scrollbar-none"
/** The section: its title, then groups spaced twice as far as their rows. */
export const SETTINGS_COLUMN =
  "flex w-full flex-col gap-7 px-8 pt-7 pb-10 w-narrow:gap-6 w-narrow:px-4 w-narrow:pt-1 w-narrow:pb-10"
export const SETTINGS_HEAD = "flex flex-col gap-1 pr-8"
export const SETTINGS_TITLE = "m-0 font-sans text-display font-semibold normal-nums text-ink"
export const SETTINGS_DESC = "m-0 text-body text-muted"
export const SETTINGS_BODY = "flex flex-col gap-7 w-narrow:gap-6"

/** A group: an optional name and note, then its rows between hairlines. */
export const SETTINGS_GROUP = "flex flex-col"
export const SETTINGS_GROUP_LABEL = "m-0 pb-1.5 font-sans text-meta font-medium normal-nums text-muted"
export const SETTINGS_GROUP_HINT = "m-0 pb-2 text-meta text-subtle"
export const SETTINGS_ROWS = "flex flex-col border-t-hairline border-t-line [&>*]:border-b-hairline [&>*]:border-b-line"

/** A row: name and note on the left, the control on the right; on a phone the control drops under the text. */
export const SETTINGS_ROW =
  "flex items-center justify-between gap-x-6 gap-y-2 py-3 w-narrow:flex-col w-narrow:items-stretch"
/** A switch stays beside its text on a phone: it is small. */
export const SETTINGS_ROW_INLINE = "flex items-center justify-between gap-x-6 py-3"
/** A wide control (a picker, a form) under the row's text. */
export const SETTINGS_ROW_STACK = "flex flex-col gap-3 py-3"
export const SETTINGS_TEXT = "flex min-w-0 flex-1 flex-col gap-0.5"
export const SETTINGS_NAME = "text-body text-ink"
export const SETTINGS_NOTE = "text-meta text-muted [&_a]:text-accent"
export const SETTINGS_CONTROL = "flex min-w-0 flex-none items-center justify-end gap-2 w-narrow:justify-start"
/** A path, command or value the Mac holds: the one place a row's text is mono. */
export const SETTINGS_VALUE = "max-w-90 min-w-0 truncate font-mono text-meta text-muted [overflow-wrap:anywhere]"

/** A line of status text in a section (loading, empty, a verdict). */
export const SETTINGS_STATUS = "m-0 py-3 text-body text-muted"

/** A text field in a settings row or form. */
export const SETTINGS_INPUT =
  "rounded-sm border-hairline border-line bg-paper px-2.5 py-1.5 font-sans text-body text-ink focus-visible:border-line-active focus-visible:outline-none"
export const SETTINGS_NUMBER = `${SETTINGS_INPUT} w-24 text-right`
export const SETTINGS_FIELD = "flex flex-col gap-1.5"
export const SETTINGS_FIELD_LABEL = "text-meta font-medium text-muted"
export const SETTINGS_TEXTAREA = "min-h-30 max-h-[50vh] leading-[1.45]"
export const SETTINGS_ACTIONS = "flex flex-wrap items-center justify-end gap-2.5"

/** An inline yes/no under a row (reset, restart, disconnect). */
export const CONFIRM_INLINE =
  "flex flex-col gap-2 rounded-sm border-hairline border-line bg-inset px-3 py-2.5 [&_p]:m-0 [&_p]:text-meta [&_p]:text-muted"
/** A sub-panel under a row: the device flow, a tier editor. */
export const SETTINGS_PANEL = "flex items-center gap-2.5 rounded-sm bg-inset px-3 py-2 text-meta"

/** Engines: one row per engine under a two-word column head. */
const ENG_GRID = "grid grid-cols-[minmax(0,1fr)_104px_72px] items-center gap-3"
export const ENG_LIST = "flex flex-col"
export const ENG_LIST_HEAD = `${ENG_GRID} pb-1.5 pl-7.5 font-sans text-meta font-medium normal-nums text-subtle [&>span:not(:first-child)]:text-center`
export const ENG_ITEM = "border-b-hairline border-b-line first:border-t-hairline first:border-t-line"
/** `group/eng`: the make-default button shows while its row is hovered or focused. No hover wash: it stacked on the open details' fill as two greys. */
export const ENG_ROW = `${ENG_GRID} group/eng rounded-sm py-1.5 pr-1 pl-0`
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
  "rounded-full bg-accent-soft px-2.5 py-0.5 font-sans text-meta font-medium normal-nums capitalize text-accent"
export const ENG_MAKE_DEFAULT =
  "rounded-full border-hairline border-line px-2.5 py-0.5 text-meta leading-[inherit] whitespace-nowrap text-muted opacity-0 transition-opacity duration-120 ease-[ease] group-hover/eng:opacity-100 group-focus-within/eng:opacity-100 hover:border-line-active hover:text-ink motion-reduce:transition-none touch:opacity-100"

/** Open details: indented under the name, no fill of their own; the row's hairlines frame them. */
export const ENG_DETAIL_AREA = "mt-0 mr-1 mb-3 ml-7 flex flex-col gap-2.5 px-1.5 py-1"
export const ENG_FACTS = "m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3.5 gap-y-1.5 text-meta leading-[1.5]"
export const ENG_FACT_TERM = "text-subtle"
export const engFactClass = (warn: boolean): string => `m-0 wrap-anywhere ${warn ? "text-warning" : "text-ink"}`
export const ENG_ACTIONS = "flex items-center gap-2"
export const ENG_RENAME_INPUT = "flex-1 px-2 py-1.25"
export const ENG_UPTODATE = "text-meta leading-[inherit] text-success"

/** A line in a list of things on this machine (a machine's GitHub sign-in, a plugin, a mod). */
export const LINE_ROW = "flex items-center gap-3 py-2.5"
export const LINE_MAIN = "flex min-w-0 flex-1 flex-col gap-0.5"
/** One line, cut with an ellipsis; `wrap` lets a description run onto more lines. */
export const lineDetailClass = (wrap = false): string =>
  `overflow-hidden text-ellipsis text-meta text-muted ${wrap ? "whitespace-normal" : "whitespace-nowrap"}`

/** Auto routing: a tier is a row whose editor opens under it. */
export const TIER_ROW = "flex flex-col gap-1 py-3"
export const TIER_HEAD = "flex items-baseline gap-3"
export const TIER_EDITOR = "flex flex-col gap-2.5 pt-2"

/** Appearance → Theme: small tiles, each a miniature window in that theme's own colours. */
export const THEME_GRID = "grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2"
export const THEME_GROUP_LABEL = "m-0 pb-1.5 text-meta font-medium text-subtle"
/** With `<Button variant="card">`: the picked card's border and fill. */
export const themeCardClass = (active: boolean): string =>
  active ? "border-accent bg-accent-soft" : "border-line hover:bg-hover"
/** The miniature window: a rail and a pane, painted in the card's own theme (inline colours, not tokens). */
export const THEME_SWATCH = "flex h-9 overflow-hidden rounded-xs border-hairline"
export const THEME_SWATCH_RAIL = "flex w-2/5 flex-col gap-0.75 p-1"
export const THEME_SWATCH_PANE = "flex min-w-0 flex-1 flex-col gap-0.75 p-1"
export const THEME_SWATCH_BAR = "h-0.75 rounded-xs"
export const THEME_SWATCH_DOTS = "mt-auto flex gap-0.75"
export const THEME_SWATCH_DOT = "size-1 rounded-xs"
export const THEME_CARD_NAME = "flex min-w-0 items-baseline gap-1.5 font-sans text-meta"
