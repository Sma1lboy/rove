/** The New session page: an empty hero above, the composer pinned to the bottom of the workspace pane. */

import { SQUARE } from "./glass.ts"
import { GROW as GROWS } from "./grow.ts"

/** Everything below inherits this font: no recipe here sets `text-meta`, which would reset line-height to normal. */
export const NEW_SESSION =
  "flex min-h-0 min-w-0 flex-1 flex-col p-4 font-mono text-meta leading-[1.5] font-normal not-italic normal-nums"
/** Gives its room to the composer: clipped on a short pane, gone while the soft keyboard is up. */
export const HERO =
  "flex min-h-0 flex-1 flex-col items-center justify-center gap-1.5 overflow-hidden text-center keyboard:hidden"

/** The prompt card on top; the toolbar of picks sits under it, outside the card. */
export const COMPOSER = "relative mx-auto flex w-full max-w-[104ch] flex-none flex-col gap-2 keyboard:mt-auto"
/** Errors and clone progress float above the card: in flow they would push the bottom-pinned composer up. */
export const NOTE = "pointer-events-none absolute bottom-full left-0 mb-2 flex flex-col gap-1"
export const CARD =
  "relative flex flex-col gap-2 rounded-md border-hairline border-line bg-surface px-3 py-2.5 focus-within:border-line-active"
export const CARD_ACTIONS = "flex flex-wrap items-center justify-end gap-1.5"
export const PROMPT = `${GROWS} min-h-[4.5em] w-full bg-transparent text-ink [border:0] [outline:0]`
/** The chips start and end on the card's edges; on a phone they sit above it, so the card itself rests on the keyboard. */
export const BAR = "group/bar flex items-center gap-1.5 narrow:order-first"
/** The engine and model chips' word: gone while the bar is `data-tight` (`useTightBar`), still the button's name. */
export const TIGHT_WORD = "group-data-tight/bar:sr-only"
/** Their glyph: shown only in a tight bar, in place of the word. */
export const TIGHT_MARK = "hidden group-data-tight/bar:contents"
/**
 * Where the task runs (left), then how (right): one row, never wrapped. A phone drops each chip's word instead
 * (`CHIP_WORD`); in a full row the engine and model chips give up their words first (`TIGHT_WORD`), then the folder its tail.
 */
export const BAR_GROUP = "flex min-w-0 items-center gap-1.5 narrow:flex-1"
/** `group/end`: the right-hand chips, whose last popover opens leftward. */
export const BAR_GROUP_END = "group/end ml-auto flex min-w-0 flex-none items-center gap-1.5"
export const GROW = "flex-1"
/** The card's own small controls (attach, dictate) left of Start; `on` while attached or recording. On a phone the first one's glyph sits as far from the card's edge as Start does from the other. */
export const cardIcon = (on = false): string =>
  `flex h-7 min-w-7 cursor-pointer items-center justify-center rounded-sm px-1 narrow:first:-ml-1.25 has-[:disabled]:opacity-60 disabled:opacity-60 hover:bg-hover hover:text-ink ${on ? "text-accent" : "text-muted"}`
export const ICON =
  "size-3.25 flex-none fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.3]"

/** A chip's word on a phone: visually gone, still the button's name. The glyph and `title` carry it. */
export const CHIP_WORD = "narrow:sr-only"

/** A chip narrows to its glyph and no further: in a full bar the words shorten, an icon-only chip keeps its shape. */
const CHIP_FLOOR = "min-w-8.5"

/** A press washes it and gives a little under the finger; no scale when the system asks for no motion. */
const CHIP_PRESS =
  "transition-[scale,background-color,color] duration-150 ease-snap active:scale-97 active:bg-hover active:text-ink motion-reduce:transition-none motion-reduce:active:scale-none"

/** A chip in the bar, the radius of a button beside it (the phone's 44px square there); `on` is the Worktree toggle while it is on. */
export const chipClass = (on = false): string =>
  `inline-flex max-w-[28ch] ${CHIP_FLOOR} items-center gap-1.5 overflow-hidden rounded-sm narrow:${SQUARE} ${CHIP_PRESS} border-hairline px-2.5 py-0.75 text-ellipsis whitespace-nowrap touch:py-1.75 narrow:min-h-11 narrow:text-[15px] hover:bg-hover hover:text-ink aria-expanded:bg-hover aria-expanded:text-ink ${
    on
      ? "border-[color-mix(in_srgb,var(--accent)_45%,transparent)] bg-accent-soft text-accent"
      : "border-line text-muted"
  }`
/** Only the toggle dims when disabled. */
export const TOGGLE_DISABLED = "disabled:cursor-default disabled:opacity-60"
/** The dictate chip: wide enough that `Stop 0:12` does not resize it while recording. */
export const dictateChip = (recording: boolean): string =>
  `${chipClass(recording)} min-w-[9ch] justify-center ${TOGGLE_DISABLED}`
/** Holding to talk: no scroll, text selection or iOS callout steals the press. */
export const DICTATE_PRESS = "touch-none select-none [-webkit-touch-callout:none]"

/**
 * `group/chip`: the last popover of the right-hand group opens leftward from its chip's right edge; any other would
 * run under the rail. A phone chip is as wide as its word, so a full bar overflows and turns `data-tight`; only then
 * does the `yields` one (the folder, the longest name) shorten into what the engine and model words gave back.
 */
export const chipWrap = (yields = false): string =>
  `group/chip relative inline-flex ${CHIP_FLOOR} narrow:shrink-0 ${yields ? "group-data-tight/bar:shrink" : ""}`
export const POP =
  "absolute bottom-[calc(100%+6px)] left-0 z-20 flex max-h-[min(50vh,420px)] max-w-[min(52ch,calc(100vw-16px))] min-w-[min(34ch,calc(100vw-16px))] flex-col overflow-hidden rounded-md border-hairline border-line-active bg-surface shadow-popover group-[&]/end:group-last-of-type/chip:right-0 group-[&]/end:group-last-of-type/chip:left-auto"

/** Rows clip sideways (a long tail shortens, see `CLIP`); only the list scrolls, and only up and down. */
export const MENU = "flex min-h-0 flex-col gap-1 overflow-x-hidden overflow-y-auto p-1.5 [outline:0]"
export const ROWS = "flex min-h-0 flex-col overflow-x-hidden overflow-y-auto"
/** A hairline between two groups of rows. */
export const RULE = "mx-2 my-1 flex-none border-t-hairline border-t-line"
/** Callers add `KICKER text-muted`. */
export const HEADING = "sticky top-0 z-1 m-0 bg-surface px-1.5 pt-1.5 pb-0.5 text-left"

export const rowClass = (o: { readonly cursor: boolean; readonly dim?: boolean }): string =>
  `flex w-full items-baseline gap-2 rounded-[calc(var(--radius)-6px)] px-2 py-1 text-left touch:py-2.5 disabled:cursor-default disabled:opacity-50 ${
    o.dim ? "text-subtle" : "text-ink"
  } ${o.cursor ? "bg-hover" : ""}`
export const CHECK = "flex-[0_0_1.5ch] text-accent"
export const DIM = "ml-auto pl-3"
export const SUBMENU_DIM = `${DIM} inline-flex items-center gap-1`
export const CLIP = "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
/** A chip's word that can outgrow the one-row bar: it shortens on a phone rather than pushing the row wide. */
export const CHIP_TEXT = `${CLIP} narrow:max-w-[13ch]`
/** Clips the head instead of the tail (a path keeps its last folders); the text inside goes in a `<bdi>`. */
export const CLIP_HEAD = `${CLIP} [direction:rtl]`
export const NAME = "flex-none whitespace-nowrap"
export const EMPTY_NOTE = "mx-2 my-1"
export const GROUP = "mx-2 mt-2 mb-0.5"
/** A list's footnote, under a hairline. */
export const HINT = "m-0 flex-none border-t-hairline border-t-line px-2 pt-1.5 pb-0.5"

export const FIELD = "flex flex-col gap-0.5 px-1.5 py-0.5"
export const BRANCHES = "min-w-[36ch]"
/** The Later popover: the time field and its confirm on one line. */
/** The field keeps the width its examples need; the button goes under it when the popover is too narrow for both. */
export const LATER = "flex flex-wrap items-center justify-end gap-1.5 p-1.5"
