/**
 * The sidebar row's ONE chip: can this PR land? Pinned by
 * `test/golden/sidebar-row-state.golden.txt`. Priority:
 *
 *   amber  conflicts with its base
 *   red    checks failing
 *   green  checks passing
 *
 * One mark (`◆`) in all three, as the web draws one PR icon; the colour is the state.
 *
 * Pending checks, review, merged/closed and board status draw nothing. An
 * unreachable provider (`prStatus.lastError`) keeps the last good value but
 * drains its colour.
 *
 * Glyph coverage (`fc-list :charset=…` over Fira Code, JetBrainsMono Nerd
 * Font, Menlo, Monaco): U+25C6 is one cell in all of them.
 */

import { rollupPr } from "@/orchestrator/task-tree"
import { DEFAULT_GLYPHS, type GlyphSet } from "@/tui/lib/glyphs"
import type { Task, TaskPRStatus } from "@/types/task"
import type { SidebarTone } from "./row-view.ts"

/** `kind` names the state: the glyph is shared, so only the tone and this tell the three apart. */
export type PrChip = { glyph: string; tone: SidebarTone; kind: "conflict" | "failing" | "passing" }

function chipOf(pr: TaskPRStatus | undefined, glyphs: GlyphSet): PrChip | null {
  if (!pr) return null
  const stale = pr.lastError !== undefined
  if ((pr.mergeable ?? "").toUpperCase() === "CONFLICTING")
    // Amber: a wait the task can clear (rebase), where red is checks that failed.
    return { kind: "conflict", glyph: glyphs.conflict, tone: stale ? "textMuted" : "warning" }
  if (pr.checkState === "failing")
    return { kind: "failing", glyph: glyphs.checksFailing, tone: stale ? "textMuted" : "error" }
  if (pr.checkState === "passing")
    return { kind: "passing", glyph: glyphs.checksPassing, tone: stale ? "textMuted" : "success" }
  return null
}

/** The task's own PR (all its repos rolled up). */
export function prChip(task: Task, glyphs: GlyphSet = DEFAULT_GLYPHS): PrChip | null {
  return chipOf(rollupPr(task), glyphs)
}

/**
 * What the sidebar draws: {@link prChip} over the task's own PRs plus the polled PRs its session
 * attached (`rove api pr-attach`), so a `dir` task with no branch of its own still shows one.
 */
export function sidebarPrChip(task: Task, glyphs: GlyphSet = DEFAULT_GLYPHS): PrChip | null {
  const attached = (task.sessionPrs ?? []).flatMap((entry) => (entry.status ? [{ prStatus: entry.status }] : []))
  return chipOf(rollupPr({ prStatus: task.prStatus, extraRepos: [...(task.extraRepos ?? []), ...attached] }), glyphs)
}
