/** The Compare page: one column per attempt of a parallel round; on a phone the columns stack. */

/** As many columns as fit, none under 17rem: a phone gets one, so the attempts stack. */
export const CMP_GRID = "mt-3 grid grid-cols-[repeat(auto-fit,minmax(min(100%,17rem),1fr))] items-start gap-x-5 gap-y-6"
/** One attempt: a hairline over it (the kept one's in the accent), no card inside the page's card. */
export const cmpColumnClass = (kept: boolean): string =>
  kept
    ? "flex min-w-0 flex-col gap-2 pt-2 [border-top:var(--hairline)_solid_var(--accent)]"
    : "flex min-w-0 flex-col gap-2 pt-2 [border-top:var(--hairline)_solid_var(--line)]"
export const CMP_HEAD = "flex min-w-0 items-center gap-2"
export const CMP_ENGINE = "min-w-0 truncate font-bold"
export const CMP_BRANCH = "truncate font-mono text-meta text-muted"
/** The latest reply, clamped: the terminal has the rest. */
export const CMP_REPLY = "m-0 line-clamp-6 whitespace-pre-wrap wrap-anywhere"
export const CMP_FILES = "flex min-w-0 flex-col"
export const CMP_FILE = "flex min-w-0 items-baseline gap-2 py-px font-mono text-meta"
export const CMP_ACTIONS = "flex flex-wrap gap-x-3.5 gap-y-1 font-mono text-meta"

/** The attempts strip over a round attempt's terminal: one line, scrolling sideways (no bar) when a phone cannot fit it. */
export const ATTEMPTS_STRIP =
  "flex min-w-0 items-center gap-3.5 overflow-x-auto px-2.5 py-1 font-mono text-meta scrollbar-none"
