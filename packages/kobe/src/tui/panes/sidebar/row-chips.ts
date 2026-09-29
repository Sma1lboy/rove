/**
 * The sidebar row's ONE chip: can this PR land? Pinned by
 * `test/golden/sidebar-row-state.golden.txt`. Priority:
 *
 *   `≠`  conflicts with its base
 *   `✗`  checks failing
 *   `✓`  checks passing
 *
 * Pending checks, review, merged/closed and board status draw nothing. An
 * unreachable provider (`prStatus.lastError`) keeps the last good value but
 * drains its colour.
 *
 * Glyph coverage (`fc-list :charset=…` over Fira Code, JetBrainsMono Nerd
 * Font, Menlo, Monaco): U+2260, U+2713, U+2717 are one cell in all of them.
 */

import { DEFAULT_GLYPHS, type GlyphSet } from "@/tui/lib/glyphs"
import type { Task } from "@/types/task"
import type { SidebarTone } from "./row-view.ts"

export function prChip(task: Task, glyphs: GlyphSet = DEFAULT_GLYPHS): { glyph: string; tone: SidebarTone } | null {
  const pr = task.prStatus
  if (!pr) return null
  const stale = pr.lastError !== undefined
  if ((pr.mergeable ?? "").toUpperCase() === "CONFLICTING")
    return { glyph: glyphs.conflict, tone: stale ? "textMuted" : "error" }
  if (pr.checkState === "failing") return { glyph: glyphs.checksFailing, tone: stale ? "textMuted" : "error" }
  if (pr.checkState === "passing") return { glyph: glyphs.checksPassing, tone: stale ? "textMuted" : "success" }
  return null
}
