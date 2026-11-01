/** Class recipes for the rail row's extras: the tree guides, the fold count, the PR chip and its card, the title tip. */

/** A child steps in under its parent; each column spans the row's full height (the padding pulled back) so lines join. */
export const CHILD_INDENT = "-my-0.75 -mr-0.5 ml-0 flex flex-none self-stretch"

const LINE =
  "before:absolute before:top-0 before:left-1 before:content-[''] before:[border-left:var(--hairline)_solid_var(--line-active)]"
const GUIDE = {
  blank: "",
  pipe: `${LINE} before:bottom-0`,
  tee: `${LINE} before:bottom-0`,
  // A rounded hook into the last child.
  elbow: `${LINE} before:right-0 before:bottom-1/2 before:rounded-bl-[6px] before:[border-bottom:var(--hairline)_solid_var(--line-active)]`,
} as const
export const guideClass = (kind: keyof typeof GUIDE): string => `relative w-3 ${GUIDE[kind]}`

/** The whole chip column of the row is the target, not just the glyph. */
export const FOLD_TOGGLE =
  "-mx-1 inline-flex min-w-6 cursor-pointer items-center justify-center gap-1 self-stretch rounded-[4px] px-2 font-mono hover:bg-hover"

export const PR_CHIP = "inline-flex items-center gap-1"
export const PR_CHIP_COUNT = "font-sans"
export const prListClass = (closing: boolean): string =>
  `fixed z-35 flex max-h-[60vh] w-110 max-w-[calc(100vw-24px)] animate-pr-list-in flex-col overflow-y-auto rounded-md border-hairline border-line bg-surface p-1.5 shadow-popover transition-[opacity,translate] duration-120 ease-in motion-reduce:animate-none motion-reduce:transition-none ${closing ? "-translate-x-1 opacity-0" : ""}`
export const PR_LIST_ITEM =
  "flex flex-col gap-1 rounded-[calc(var(--radius)-6px)] px-3 py-2 text-left font-sans enabled:hover:bg-hover"
export const PR_LIST_TITLE = "truncate font-semibold text-ink"
export const PR_LIST_LINE = "flex items-baseline gap-0 text-meta leading-[inherit] whitespace-nowrap"
export const PR_LIST_STATE = "inline-flex items-baseline gap-1.25"
export const PR_LIST_GLYPH = "font-mono"
/** A flex item drops its leading space; `pre` keeps the `, ` after the state word. */
export const PR_LIST_META = "overflow-hidden text-ellipsis whitespace-pre text-muted"
export const PR_LIST_STATS = "ml-auto flex gap-1.5 pl-3 tabular-nums"

/** A rail row's cut-off title in full, beside the row (Claude's sidebar tooltip). */
export const ROW_TIP =
  "pointer-events-none fixed z-35 max-w-80 -translate-y-1/2 animate-row-tip-in rounded-sm border-hairline border-line bg-inset px-2.5 py-1.5 text-meta leading-[1.4] whitespace-normal wrap-anywhere text-ink shadow-popover motion-reduce:animate-none"

/** A task on another machine: a small cloud at the row's right edge. */
export const CLOUD_MARK = "inline-flex flex-none items-center text-subtle"
