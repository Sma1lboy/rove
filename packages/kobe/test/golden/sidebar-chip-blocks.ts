/**
 * The CHIP half of the sidebar-row golden: three pure maps from ONE persisted
 * field each to a glyph + tone — `prStatus.checkState`, `prStatus.mergeable`,
 * and the human-set `task.status`.
 *
 * Split out of `sidebar-state-matrix.ts` because they are a different KIND of
 * enumeration: everything left there builds a whole `SidebarRowView` and
 * crosses activity against a dozen axes, while these three take one field and
 * a staleness bit and produce one cell. They share only the `task()` fixture,
 * which is imported.
 */

import { prCheckChip, prConflictChip, statusChip } from "@/tui/panes/sidebar/row-view"
import { TASK_STATUSES, type Task } from "@/types/task"
import { pad } from "./golden-file"
import { task } from "./sidebar-state-matrix"

/**
 * The PR-check chip: a pure map from the daemon-written `checkState`, crossed
 * with `lastError` — the field the poller sets when `gh` could not reach the
 * provider. A stale chip keeps its GLYPH (the last good reading is still the
 * best answer available) and loses its colour, so the pairs in this block read
 * as the same fact twice: confirmed, and no longer being confirmed.
 */
export function prChipBlock(): string[] {
  const states = [undefined, "none", "unknown", "passing", "failing", "pending"] as const
  const lines: string[] = []
  for (const checkState of states) {
    for (const lastError of [undefined, "gh: could not resolve host"]) {
      const subject = task({
        prStatus:
          checkState === undefined
            ? undefined
            : ({ checkState, ...(lastError ? { lastError } : {}) } as Task["prStatus"]),
      })
      const chip = prCheckChip(subject)
      lines.push(
        `${pad(`checkState=${checkState ?? "<no prStatus>"}`, 28)} ${pad(`stale=${lastError ? "1" : "0"}`, 8)} chip=${chip ? `${chip.glyph} (${chip.tone})` : "<none>"}`,
      )
    }
  }
  return lines
}

/**
 * The merge-conflict chip: `prStatus.mergeable`, which the poller has been
 * collecting since it landed and nothing rendered. Enumerated over every value
 * GitHub returns, so the two deliberate silences (`UNKNOWN` — GitHub is still
 * recomputing after a push — and `MERGEABLE`) are pinned as behaviour rather
 * than left to be re-decided. Crossed with `lastError` for the same reason
 * `prChipBlock` is: a stale reading keeps its glyph and loses its colour.
 */
export function conflictChipBlock(): string[] {
  const values = [undefined, "MERGEABLE", "CONFLICTING", "UNKNOWN", "conflicting"] as const
  const lines: string[] = []
  for (const mergeable of values) {
    for (const lastError of [undefined, "gh: could not resolve host"]) {
      const subject = task({
        prStatus: {
          checkState: "passing",
          ...(mergeable ? { mergeable } : {}),
          ...(lastError ? { lastError } : {}),
        } as Task["prStatus"],
      })
      const chip = prConflictChip(subject)
      lines.push(
        `${pad(`mergeable=${mergeable ?? "<absent>"}`, 28)} ${pad(`stale=${lastError ? "1" : "0"}`, 8)} chip=${chip ? `${chip.glyph} (${chip.tone})` : "<none>"}`,
      )
    }
  }
  // A row with no PR at all must not draw it either.
  lines.push(`${pad("<no prStatus>", 28)} ${pad("stale=0", 8)} chip=${prConflictChip(task({})) ? "?" : "<none>"}`)
  return lines
}

/**
 * The board-status chip: a pure map from the human-set `task.status`.
 *
 * Enumerated over the WHOLE union rather than the four states that render, so
 * the two deliberate silences (`backlog`, `in_progress` — the states the auto
 * status rule drives, which every ordinary row sits in) are pinned as
 * behavior instead of left to be re-decided, and a seventh status added to
 * `TaskStatus` shows up in this diff on the day it lands.
 *
 * Read it against the PR-chip block above: the two chips share a row, so no
 * glyph may appear in both tables.
 */
export function statusChipBlock(): string[] {
  return TASK_STATUSES.map((status) => {
    const chip = statusChip(task({ status }))
    return `${pad(`status=${status}`, 28)} chip=${chip ? `${chip.glyph} (${chip.tone})` : "<none>"}`
  })
}
