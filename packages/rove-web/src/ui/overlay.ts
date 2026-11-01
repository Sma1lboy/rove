/**
 * Dialogs, the row menu and toasts. `overlay`, `dialog`, `dialog-body`, `menu` and `toast` stay as hooks: focus-trap.ts
 * and leave.ts find them, and leave.ts copies a closing one into an `is-leaving` ghost that sinks out. Under reduced
 * motion nothing rises in, but a ghost still fades, as before.
 */

/** A short screen (a phone on its side) lends a dialog nearly all its height. */
export const OVERLAY = "overlay fixed inset-0 z-20 grid justify-items-center [align-items:start] bg-(--scrim) pt-[12vh] motion-safe:animate-fade-in [&.is-leaving]:animate-fade-out short:pt-3"

/** `wide` for a form with two columns of fields. */
export const dialogClass = (wide = false): string =>
  `dialog static m-0 flex max-h-[76vh] ${wide ? "w-[min(620px,calc(100vw-32px))]" : "w-[min(440px,calc(100vw-32px))]"} flex-col gap-3 rounded-md border-hairline border-line bg-surface px-5 py-4.5 text-inherit shadow-dialog focus:outline-none motion-safe:animate-rise-in [.is-leaving_&]:animate-sink-out short:max-h-[calc(100dvh-24px)] short:px-4 short:py-3`

export const DIALOG_HEAD = "flex items-center justify-between gap-3"

/** A sentence that often quotes the user's own words: ink and sentence case, never an uppercased kicker. */
export const DIALOG_TITLE = "m-0 min-w-0 font-sans text-body leading-[1.4] font-semibold normal-nums text-ink wrap-anywhere"

export const DIALOG_CLOSE =
  "grid size-6 place-items-center -my-1 mr-[-6px] ml-0 rounded-sm text-display leading-none text-muted hover:bg-inset hover:text-ink focus-visible:bg-inset focus-visible:text-ink touch:relative touch:after:absolute touch:after:-inset-2.5 touch:after:content-['']"

/** Scrolls under its sticky actions; the 2px bleed leaves room for a focus ring the scroller would clip. */
export const DIALOG_BODY =
  "dialog-body -m-0.5 flex min-h-0 flex-col gap-3 overflow-y-auto p-0.5 [&_p]:m-0 [&>.actions]:sticky [&>.actions]:-bottom-0.5 [&>.actions]:bg-surface [.dialog-body+div>&]:mt-3.5"

export const menuClass = (sub = false): string =>
  `menu fixed z-30 flex max-h-[calc(100vh-16px)] ${sub ? "min-w-40" : "min-w-50"} origin-top-left flex-col overflow-y-auto rounded-md border-hairline border-line bg-surface p-1 shadow-popover motion-safe:animate-menu-in [&.is-leaving]:animate-sink-out`

/** Label and key share a baseline: two sizes left to stretch sit top-aligned and read off by a few pixels. */
export const menuItemClass = (s: { selected?: boolean; open?: boolean; danger?: boolean }): string =>
  `flex items-baseline justify-between gap-6 rounded-[calc(var(--radius)-4px)] px-2.5 py-1.25 text-left text-body leading-[inherit] touch:py-2.5 ${
    s.danger && s.selected ? "bg-error text-paper" : s.selected || s.open ? "bg-hover" : ""
  } ${s.danger && !s.selected ? "text-error" : ""} ${s.selected ? "forced-colors:outline-2 forced-colors:-outline-offset-2 forced-colors:outline-[Highlight] forced-colors:outline-solid" : ""}`

const MENU_META = "font-mono text-meta normal-nums"
export const menuKeyClass = (s: { selected?: boolean; danger?: boolean }): string =>
  `${MENU_META} ${s.danger && s.selected ? "text-inherit" : s.selected ? "text-muted" : "text-subtle"} touch:hidden!`
export const menuChevronClass = (lit: boolean): string => `${MENU_META} ${lit ? "text-ink" : "text-subtle"}`
export const MENU_CHECK = `${MENU_META} text-accent`

/** Full-bleed hairline between sections, as claude.ai's separators run to the menu's border. */
export const MENU_SEP = "-mx-1 my-1 h-px flex-none border-none bg-line"

export const TOASTS = "fixed right-3.5 bottom-8.5 z-40 flex flex-col gap-1.5"
export const toastClass = (error: boolean): string =>
  `toast max-w-105 cursor-pointer rounded-sm border-hairline border-line bg-inset px-3 py-1.75 text-left font-sans text-meta wrap-anywhere ${error ? "text-error" : "text-ink"} motion-safe:animate-rise-in [&.is-leaving]:animate-sink-out`
