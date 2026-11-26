/** The Compare page: one column per attempt of a parallel round; on a phone the columns stack. */

/** The prompt every attempt was given, under the title: quoted prose, clamped (its full text is the block's title). */
export const CMP_PROMPT =
  "m-0 mt-1.5 line-clamp-4 max-w-[90ch] whitespace-pre-wrap wrap-anywhere rounded-sm bg-inset px-3 py-2 text-ink"
/** As many columns as fit, none under 24rem: a phone gets one, so the attempts stack. Columns share their height, so the actions line up. */
export const CMP_GRID = "mt-4 grid grid-cols-[repeat(auto-fit,minmax(min(100%,24rem),1fr))] items-stretch gap-3"
/** One attempt: a filled panel on the page (no border: no frame inside the page's frame); the kept one ringed in the accent. */
export const cmpColumnClass = (kept: boolean): string =>
  `flex min-w-0 flex-col gap-2 rounded-md border-hairline bg-inset px-3 pt-2.5 pb-3 ${kept ? "border-accent" : "border-transparent"}`
export const CMP_HEAD = "flex min-w-0 items-center gap-2"
export const CMP_ENGINE = "min-w-0 truncate font-bold"
export const CMP_BRANCH = "truncate font-mono text-meta text-muted"
/** The latest reply, clamped: the terminal has the rest. */
export const CMP_REPLY = "m-0 line-clamp-4 whitespace-pre-wrap wrap-anywhere"
export const CMP_SUMMARY = "m-0 flex gap-2 font-mono text-meta text-muted"
/**
 * The attempt's diff, full bleed in its panel on the page's ground, scrolling inside its own box. `group/preview`
 * lends it the side panel's row look, narrow columns included.
 */
export const CMP_DIFF =
  "group/preview @container/preview -mx-3 max-h-[min(60vh,40rem)] min-h-0 overflow-x-hidden overflow-y-auto bg-paper py-1.5 font-mono text-meta/normal [&>:first-child]:mt-0 [&>:first-child]:border-t-0"
export const CMP_DIFF_FILE = "group w-full text-left"
export const CMP_DIFF_NAME = "min-w-0 truncate group-hover:underline"
/** Keep first, then the ways into the task; pinned to the panel's foot and as tall with or without the button, so every column's line up. */
export const CMP_ACTIONS = "mt-auto flex min-h-7.5 flex-wrap items-center gap-x-3.5 gap-y-1 pt-1 font-mono text-meta"

/** The attempts strip over a round attempt's terminal: wraps onto a second line when a phone cannot fit it, so `[ compare ]` is never off-screen. */
export const ATTEMPTS_STRIP = "flex min-w-0 flex-wrap items-center gap-x-3.5 gap-y-0.5 px-2.5 py-1 font-mono text-meta"
