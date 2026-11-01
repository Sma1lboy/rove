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

/** The rail itself; `rail` stays as the hook workspace.css's fold and grid rules hang on. */
export const RAIL = "group/rail rail row-1 flex min-h-0 flex-col focus:outline-none"
/** One line, whatever the rail's width: the wordmark left, the inbox count and the update arrow right. */
export const RAIL_HEAD =
  "rail-head flex min-w-0 items-center gap-2.5 overflow-hidden px-3.5 pt-3.5 pb-2.5 whitespace-nowrap"
export const RAIL_SEARCH = "flex gap-1 px-3.5 pb-2 text-meta leading-[inherit]"
export const RAIL_CARET = "text-accent animate-blink motion-reduce:animate-none"
/** The rail scrolls without a visible bar (the owner's call: the list reads cleaner without one). */
export const railBody = (sorting: boolean): string =>
  `flex-1 overflow-y-auto px-1.5 pt-1 pb-3 scrollbar-none ${sorting ? "[&>[data-row]]:[transition:transform_150ms_ease-out] motion-reduce:[&>[data-row]]:transition-none" : ""}`
/** Keyboard cursor: shown only while the rail has focus, as the TUI sidebar's. */
export const RAIL_CURSOR = "group-focus-within/rail:[box-shadow:inset_0_0_0_1px_var(--focus)]"

/** A project section header, as Claude's sidebar: the name and a chevron fold it; + starts a task in it. Move mode and a drag wash it. */
export const projectHead = (o: { moving: boolean; dragging: boolean }): string =>
  `group/head mx-2 mt-1.5 mb-1 flex items-center gap-1 font-mono text-meta font-semibold text-subtle not-first:mt-4.5 ${o.moving || o.dragging ? "bg-accent-soft" : ""} ${o.moving ? "after:font-mono after:text-meta after:font-medium after:text-accent after:content-['move']" : ""}`
const HIT =
  "touch:relative touch:after:absolute touch:after:-inset-x-1.5 touch:after:-inset-y-3 touch:after:content-['']"
export const PROJECT_TOGGLE = `group/toggle -ml-1 inline-flex min-w-0 cursor-pointer items-center gap-1 rounded-[4px] border-none bg-transparent px-1 py-0.5 text-inherit [font:inherit] hover:text-ink ${HIT}`
/** Hidden until the header is hovered or the toggle focused; always shown to a finger. A folded one always shows. */
export const projectChevron = (folded: boolean): string =>
  folded ? "" : "opacity-0 group-hover/head:opacity-100 group-focus-visible/toggle:opacity-100 touch:opacity-100"
/** Centred on the task rows' status dot: the dot is ~6.6px wide (1ch of 11px mono), so the 20px + overhangs by ~6.7px. */
export const PROJECT_ADD = `-mr-[6.7px] ml-auto size-5 cursor-pointer rounded-[4px] border-none bg-transparent text-muted opacity-0 [font:400_var(--fs-display)/1_var(--sans)] group-hover/head:opacity-100 hover:bg-hover hover:text-ink focus-visible:opacity-100 touch:opacity-100 ${HIT}`
