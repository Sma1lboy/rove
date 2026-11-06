/** The New session page: heading and composer as one block, centred a little above the middle of the pane. */

/** Everything below inherits this font: no recipe here sets `text-meta`, which would reset line-height to normal. */
export const NEW_SESSION =
  "flex min-h-0 min-w-0 flex-1 flex-col justify-center overflow-y-auto p-4 pb-[10vh] font-mono text-meta leading-[1.5] font-normal not-italic normal-nums"
export const HERO = "mb-6 flex flex-none flex-col items-center gap-1.5 text-center"

/** The prompt card on top; the toolbar of picks sits under it, outside the card. */
export const COMPOSER = "mx-auto flex w-full max-w-[104ch] flex-col gap-2"
export const CARD =
  "flex flex-col gap-2 rounded-md border-hairline border-line bg-surface px-3 py-2.5 focus-within:border-line-active"
export const CARD_ACTIONS = "flex flex-wrap items-center justify-end gap-1.5 [&>*]:flex-none [&>*]:whitespace-nowrap"
/** Create and Start stay side by side; on a phone the pair wraps as one. */
export const CARD_SUBMIT = "flex flex-none items-center gap-1.5 [&>*]:whitespace-nowrap"
export const PROMPT = "max-h-[40vh] min-h-[4.5em] w-full bg-transparent text-ink [border:0] [outline:0]"
/** Two groups: where it runs (left) and what runs (right); each wraps whole, so no chip is left alone. */
export const BAR = "flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-1"
export const BAR_GROUP = "flex min-w-0 flex-wrap items-center gap-1.5"
export const BAR_END = `bar-end ${BAR_GROUP}`
export const ICON =
  "size-3.25 flex-none fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.3]"

/** A pill in the bar; `on` is the Worktree toggle while it is on. Hover applies on touch too, as the sheet's did. */
export const chipClass = (on = false): string =>
  `inline-flex max-w-[28ch] items-center gap-1.5 overflow-hidden rounded-full border-hairline px-2.5 py-0.75 text-ellipsis whitespace-nowrap touch:py-1.75 [&:hover]:bg-hover [&:hover]:text-ink aria-expanded:bg-hover aria-expanded:text-ink ${
    on
      ? "border-[color-mix(in_srgb,var(--accent)_45%,transparent)] bg-accent-soft text-accent"
      : "border-line text-muted"
  }`
/** Only the toggle dims when disabled. */
export const TOGGLE_DISABLED = "disabled:cursor-default disabled:opacity-60"

/** `bar-end`: the last chip of the right group opens leftward from its chip's right edge. */
export const CHIP_WRAP = "group/chip relative inline-flex"
export const POP =
  "absolute bottom-[calc(100%+6px)] left-0 z-20 flex max-h-[min(50vh,420px)] max-w-[min(52ch,calc(100vw-16px))] min-w-[min(34ch,calc(100vw-16px))] flex-col overflow-hidden rounded-md border-hairline border-line-active bg-surface shadow-popover [.bar-end>:last-child>&]:right-0 [.bar-end>:last-child>&]:left-auto"

export const MENU = "flex min-h-0 flex-col gap-1 overflow-y-auto p-1.5 [outline:0]"
export const ROWS = "flex min-h-0 flex-col overflow-y-auto"
/** Callers add `KICKER text-muted`. */
export const HEADING = "sticky top-0 z-1 m-0 bg-surface px-1.5 pt-1.5 pb-0.5 text-left"

export const rowClass = (o: { readonly cursor: boolean; readonly dim?: boolean }): string =>
  `flex w-full items-baseline gap-2 rounded-[calc(var(--radius)-6px)] px-2 py-1 text-left touch:py-2.5 disabled:cursor-default disabled:opacity-50 ${
    o.dim ? "text-subtle" : "text-ink"
  } ${o.cursor ? "bg-hover" : ""}`
/** The row that opens a submenu (Effort), ruled off from the rows above. */
export const SUBMENU_ROW = "mt-1 border-t-hairline border-t-line"
export const CHECK = "flex-[0_0_1.5ch] text-accent"
export const DIM = "ml-auto pl-3"
export const SUBMENU_DIM = `${DIM} inline-flex items-center gap-1`
export const CLIP = "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
export const NAME = "flex-none whitespace-nowrap"
export const EMPTY_NOTE = "mx-2 my-1"
export const GROUP = "mx-2 mt-2 mb-0.5"

/** Same text position on touch, taller tap target. */
export const MORE =
  "mt-2 self-center px-1.5 py-0.5 text-subtle focus-visible:text-ink touch:mt-0.5 touch:py-2 [&:hover]:text-ink"

export const FIELD = "flex flex-col gap-0.5 px-1.5 py-0.5"
export const BRANCHES = "min-w-[36ch]"
