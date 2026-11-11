/** The update page, What's New and the release notes they share; the Worktrees page. */

import { PAGE } from "./page.ts"

export const PAGE_HEAD = "flex items-baseline justify-between"
export const UPDATE_VERSIONS = "[&_b]:mr-2.5"
/** The page scrolls above its actions, which stay at the bottom. */
export const UPDATE_PAGE = `${PAGE} flex flex-col overflow-hidden`
export const UPDATE_SCROLL = "min-h-0 flex-1 overflow-y-auto"
/** The installer's output tail while Update now runs. */
export const UPDATE_OUTPUT =
  "my-2 max-h-[40vh] overflow-auto whitespace-pre-wrap wrap-anywhere rounded-sm bg-inset p-2 font-mono text-[length:var(--fs-meta)]"
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
export const wtRowClass = (cursor: boolean): string => `rounded-sm px-2 py-1.25 ${cursor ? "bg-menu" : ""}`
export const WT_LINE = "flex items-baseline gap-2 text-[length:var(--fs-body)]"
/** The path line also carries `.mono`, which sets its size. */
export const WT_LINE_META = "flex items-baseline justify-between gap-2"
export const WT_BRANCH = "font-mono"
export const WT_PATH = "truncate"
export const WT_HINTS = "mt-4 text-[length:var(--fs-meta)]"
