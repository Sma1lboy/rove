/**
 * The sidebar row's CHIP family: four pure `Task → { glyph, tone } | null`
 * maps, one per persisted field, that share the row's right-hand cell group.
 *
 * Split from `row-view.ts` because they are a different KIND of derivation
 * from everything left there. `buildSidebarRowView` is a PRIORITY LADDER over
 * live state — deletion beats a materializing job beats an activity word beats
 * the branch — and its inputs are the engine, the daemon and the clock. These
 * take ONE stored field each and answer with one cell, with no ordering
 * between them and no runtime input at all. The golden already treats them as
 * two different enumerations (`sidebar-chip-blocks.ts` vs
 * `sidebar-state-matrix.ts`); this is the same seam on the source side.
 *
 * The constraint that binds the four together, and the reason they belong in
 * ONE file rather than four: they render side by side, so no glyph may mean
 * two things. Adding a chip means reading the other three first.
 *
 * Pure — pinned by `test/golden/sidebar-row-state.golden.txt`.
 */

import type { Task } from "@/types/task"
import type { SidebarTone } from "./row-view.ts"
import { DEAD_GLYPH, ERROR_GLYPH } from "./row-view.ts"

/**
 * The right-stuck PR-check chip for a task's subtitle row. The
 * daemon's pr-status poller writes `task.prStatus`; this maps its `checkState`
 * to a single coloured glyph (✓ passing / ✗ failing / • pending). Returns null
 * for tasks with no PR or no checks configured (`none` / `unknown`) so the row
 * stays clean. Pure — unit-tested.
 */
export function prCheckChip(task: Task): { glyph: string; tone: SidebarTone } | null {
  // A poll that could not reach the provider (`prStatus.lastError`) leaves the
  // last GOOD value on the chip — clobbering a green tick over a transient
  // `gh` blip would be worse. Muted is how the row says that value is no
  // longer being refreshed: same glyph, because the fact itself has not
  // changed; drained of colour, because nothing is confirming it any more. Not
  // a second glyph — this cell shares a row with `statusChip`, and there is no
  // glyph left in that shared vocabulary that means "old".
  const stale = task.prStatus?.lastError !== undefined
  switch (task.prStatus?.checkState) {
    case "passing":
      return { glyph: "✓", tone: stale ? "textMuted" : "success" }
    case "failing":
      return { glyph: "✗", tone: stale ? "textMuted" : "error" }
    case "pending":
      return { glyph: "•", tone: stale ? "textMuted" : "warning" }
    default:
      return null
  }
}

/**
 * The merge-conflict chip: the PR cannot be merged as it stands.
 *
 * `prStatus.mergeable` has been collected onto the task record since the PR
 * poller landed and rendered NOWHERE — a PR whose branch conflicts with its
 * base looked identical to a healthy one until you tried to land it, which is
 * the moment it is most expensive to discover.
 *
 * `≠` (U+2260, Mathematical Operators) is the glyph, and it is chosen the same
 * way `×` and `†` were — by font coverage first. `fc-list :charset=2260`:
 * Fira Code, FiraCode/JetBrainsMono Nerd Font, Menlo AND Monaco, so it lands
 * at exactly one cell everywhere the existing chips do. (The obvious pick, `⑂`
 * U+2442 OCR FORK, is in NONE of them and renders as tofu.) It also says the
 * right thing: the branch and its base do not reconcile.
 *
 * It reads next to, not instead of, {@link prCheckChip} — red checks and a
 * conflicted merge are different facts and a row can carry both. GitHub
 * reports `UNKNOWN` while it recomputes mergeability after a push, which is
 * not the same as conflicting, so only the explicit `CONFLICTING` draws.
 *
 * Pure — pinned by `test/golden/sidebar-row-state.golden.txt`.
 */
export function prConflictChip(task: Task): { glyph: string; tone: SidebarTone } | null {
  if ((task.prStatus?.mergeable ?? "").toUpperCase() !== "CONFLICTING") return null
  // Muted for the same reason `prCheckChip` mutes: a poll that could not reach
  // the provider leaves the last good value on the row, and nothing is
  // confirming it any more.
  return { glyph: "\u2260", tone: task.prStatus?.lastError === undefined ? "error" : "textMuted" }
}

/**
 * The review-state chip: where the PR stands with its REVIEWERS.
 *
 * `prStatus.lifecycle` is the poller's normalised review verdict \u2014 it folds
 * `reviewDecision: APPROVED` on an open PR into `ready_to_merge` \u2014 and until
 * now nothing rendered it. A green `\u2713` from {@link prCheckChip} means CI
 * passed, which is also what it means on a PR nobody has looked at yet and on
 * one that merged an hour ago. Picking the attempt to land is exactly the
 * moment those three have to read differently.
 *
 * Glyphs, chosen by font coverage first like `\u2260` and `\u00d7` before them
 * (`fc-list :charset=<hex>` over Fira Code, JetBrainsMono Nerd Font, Menlo and
 * Monaco \u2014 all four carry both, at one cell):
 *
 *   - `\u00bb` (U+00BB) \u2014 approved and clear to advance.
 *   - `\u2261` (U+2261) \u2014 merged: the branch and its base now say the same thing.
 *
 * Neither appears in `prCheckChip`, `prConflictChip` or {@link statusChip},
 * which share the row: no glyph may mean two things in one cell group. The
 * raw `reviewDecision` string never reaches the row \u2014 it is vendor text, and
 * `lifecycle` is the normalised form of the same fact.
 *
 * Every other lifecycle draws nothing: an ordinary open PR, a closed one and
 * `creating`/`unknown` all have no review verdict worth a cell.
 *
 * Pure \u2014 pinned by `test/golden/sidebar-row-state.golden.txt`.
 */
export function prReviewChip(task: Task): { glyph: string; tone: SidebarTone } | null {
  // Muted for the same reason the two chips beside it mute: a poll that could
  // not reach the provider leaves its last good value on the row, and a stale
  // "approved" is the one this cell must not paint confidently.
  const stale = task.prStatus?.lastError !== undefined
  switch (task.prStatus?.lifecycle) {
    case "ready_to_merge":
      return { glyph: "\u00bb", tone: stale ? "textMuted" : "success" }
    case "merged":
      return { glyph: "\u2261", tone: "textMuted" }
    default:
      return null
  }
}

/**
 * The human-set lifecycle chip for a worktree row. `task.status` is the board
 * lifecycle the user drives (`rove api set-status`, the sidebar menu's
 * "Set status"); this maps it to one coloured glyph so a row can say where its
 * work stands without opening it.
 *
 * `backlog` and `in_progress` return null on purpose. They are the two states
 * a task passes through automatically (`monitor/status-rules.ts` moves
 * backlog → in_progress on the first turn), so charging every ordinary row a
 * cell to say "this is an ordinary row" would just add noise; the chip appears
 * exactly when a human has said something the row could not otherwise tell you.
 *
 * The glyphs deliberately REUSE the tree's existing failure vocabulary rather
 * than inventing a second one: `×` is what an errored engine already wears on
 * a tab row and `†` what a dead one does, and "the user marked this errored /
 * abandoned" is the same news about the same task. `◇`/`◆` are new here and
 * pair on purpose — outline = still open for a human, filled = closed out —
 * the same outline/filled contrast the tab rows use for `○`/`●`.
 *
 * Distinct from {@link prCheckChip}, which reports a MACHINE fact (CI) and
 * keeps its own `✓`/`✗`; the two render side by side, so neither may borrow
 * the other's glyphs. Pure — pinned by `test/golden/sidebar-row-state.golden.txt`.
 */
export function statusChip(task: Task): { glyph: string; tone: SidebarTone } | null {
  switch (task.status) {
    case "in_review":
      return { glyph: "◇", tone: "primary" }
    case "done":
      return { glyph: "◆", tone: "success" }
    case "canceled":
      return { glyph: DEAD_GLYPH, tone: "textMuted" }
    case "error":
      return { glyph: ERROR_GLYPH, tone: "error" }
    default:
      return null
  }
}
