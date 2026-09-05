/**
 * The CHIP half of the sidebar-row golden: one pure map from `task.prStatus`
 * to a glyph + tone.
 *
 * Split out of `sidebar-state-matrix.ts` because it is a different KIND of
 * enumeration: everything left there builds a whole `SidebarRowView` and
 * crosses activity against a dozen axes, while this takes one field and a
 * staleness bit and produces one cell. They share only the `task()` fixture.
 */

import { prChip } from "@/tui/panes/sidebar/row-chips"
import { TASK_STATUSES, type Task } from "@/types/task"
import { pad } from "./golden-file"
import { task } from "./sidebar-state-matrix"

/**
 * `checkState` × `mergeable` × `lastError`. Pins the priority (a conflict
 * outranks any check result), the deliberate silences (`pending`, `none`,
 * `unknown`, `MERGEABLE`, GitHub's post-push `UNKNOWN`), and the stale rule: a
 * poll that could not reach the provider keeps its glyph and loses its colour.
 */
export function prChipBlock(): string[] {
  const checks = [undefined, "none", "unknown", "passing", "failing", "pending"] as const
  const mergeables = [undefined, "MERGEABLE", "CONFLICTING", "UNKNOWN", "conflicting"] as const
  const lines: string[] = []
  for (const checkState of checks) {
    for (const mergeable of mergeables) {
      for (const lastError of [undefined, "gh: could not resolve host"]) {
        const subject = task({
          prStatus:
            checkState === undefined
              ? undefined
              : ({
                  checkState,
                  ...(mergeable ? { mergeable } : {}),
                  ...(lastError ? { lastError } : {}),
                } as Task["prStatus"]),
        })
        const chip = prChip(subject)
        lines.push(
          `${pad(`checkState=${checkState ?? "<no prStatus>"}`, 24)} ${pad(`mergeable=${mergeable ?? "<absent>"}`, 24)} ${pad(`stale=${lastError ? "1" : "0"}`, 8)} chip=${chip ? `${chip.glyph} (${chip.tone})` : "<none>"}`,
        )
      }
    }
  }
  return lines
}

/**
 * The human-set board status never reaches the rail: whoever set it already
 * knows it. Enumerated over the whole union so a seventh status shows up here
 * the day it lands.
 */
export function statusChipBlock(): string[] {
  return TASK_STATUSES.map((status) => {
    const chip = prChip(task({ status, prStatus: { checkState: "passing" } as Task["prStatus"] }))
    return `${pad(`status=${status}`, 28)} chip=${chip ? `${chip.glyph} (${chip.tone})` : "<none>"}`
  })
}
