/**
 * The sidebar row's ONE chip: what the PR is doing. Pure `Task → { glyph,
 * tone } | null`, pinned by `test/golden/sidebar-row-state.golden.txt`.
 *
 * Split from `row-view.ts` because it is a different KIND of derivation:
 * `buildSidebarRowView` is a PRIORITY LADDER over live state, this takes one
 * stored field and answers with one cell.
 *
 * Four chips used to share this cell group (CI, merge conflict, review
 * verdict, human-set board status), each with its own glyph pair, and the
 * rail read like a legend. The reader wants one answer: can this land, or is
 * something in the way. So, in priority order:
 *
 *   `≠`  conflicts with its base — nothing else matters until that is fixed
 *   `✗`  checks failing
 *   `✓`  checks passing
 *
 * Pending checks, review state, merged/closed and the board status draw
 * nothing: "nothing yet" is the honest cell, and the board status is what a
 * human already knows because they set it.
 *
 * A poll that could not reach the provider (`prStatus.lastError`) keeps the
 * last GOOD value and drains its colour — the fact has not changed, nothing is
 * confirming it any more.
 *
 * Glyph coverage (`fc-list :charset=…` over Fira Code, JetBrainsMono Nerd
 * Font, Menlo, Monaco): `≠` U+2260 and `✓`/`✗` U+2713/U+2717 all land at one
 * cell in every one of them.
 */

import type { Task } from "@/types/task"
import type { SidebarTone } from "./row-view.ts"

export function prChip(task: Task): { glyph: string; tone: SidebarTone } | null {
  const pr = task.prStatus
  if (!pr) return null
  const stale = pr.lastError !== undefined
  if ((pr.mergeable ?? "").toUpperCase() === "CONFLICTING")
    return { glyph: "\u2260", tone: stale ? "textMuted" : "error" }
  if (pr.checkState === "failing") return { glyph: "✗", tone: stale ? "textMuted" : "error" }
  if (pr.checkState === "passing") return { glyph: "✓", tone: stale ? "textMuted" : "success" }
  return null
}
