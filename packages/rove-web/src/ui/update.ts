/** The update page, What's New and the release notes they share; the Worktrees page. */

export const PAGE_HEAD = "flex items-baseline justify-between"
export const UPDATE_VERSIONS = "[&_b]:mr-2.5"
export const UPDATE_ACTIONS = "my-2.5 flex flex-col"
export const updateActionClass = (cursor: boolean): string =>
  `flex gap-3 rounded-sm px-2 py-1 text-left text-[length:var(--fs-body)] ${cursor ? "bg-inset" : ""}`
export const UPDATE_LABEL = "min-w-[14ch]"
/** The rail's ↑ chip; the version drops when the rail is narrow. */
export const UPDATE_CHIP = "whitespace-nowrap text-[length:var(--fs-meta)] text-warning"
export const UPDATE_CHIP_VERSION = "rail-tight:hidden"
export const RELEASE_NOTES = "[&_h2]:mx-0 [&_h2]:mt-3.5 [&_h2]:mb-1 [&_h2]:text-[length:var(--fs-body)]"
export const WHATS_NEW_BODY = "max-h-[55vh] overflow-x-hidden overflow-y-auto"
export const WHATS_NEW_KEYS = "mr-auto text-[length:var(--fs-meta)]"
/** Changelog markdown (release-notes.tsx): wrapped, never a sideways scroll. */
export const RELEASE_MD =
  "text-[length:var(--fs-body)] leading-[1.55] wrap-anywhere [&_h3]:mx-0 [&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:font-sans [&_h3]:text-meta [&_h3]:font-medium [&_h3]:normal-nums [&_h3]:text-muted [&_h3:first-child]:mt-0 [&_ul]:m-0 [&_ul]:pl-4.5 [&_li+li]:mt-2 [&_p]:mx-0 [&_p]:mt-0 [&_p]:mb-2 [&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2 [&_code]:rounded-sm [&_code]:bg-inset [&_code]:px-1 [&_code]:py-0 [&_code]:font-mono [&_code]:text-meta [&_code]:font-normal [&_code]:normal-nums"

/** Worktrees */
export const WT_GROUP = "mt-3"
export const wtRowClass = (cursor: boolean): string => `rounded-sm px-2 py-1.25 ${cursor ? "bg-inset" : ""}`
export const WT_LINE = "flex items-baseline gap-2 text-[length:var(--fs-body)]"
/** The path line also carries `.mono`, which sets its size. */
export const WT_LINE_META = "flex items-baseline justify-between gap-2"
export const WT_BRANCH = "font-mono"
export const WT_PATH = "truncate"
export const WT_HINTS = "mt-4 text-[length:var(--fs-meta)]"
