/**
 * The MACHINE layer of the sidebar tree. Machines are not sections: projects
 * from every machine already share one list (`buildSidebarGroups` merges a
 * repo's checkouts by `repoId`). This layer only says, per row, where a task
 * from ANOTHER machine lives — the renderer draws that as a cloud mark.
 *
 *  1. Zero machines → returns the SAME array (identity included), so
 *     machine-free sidebar goldens match byte for byte.
 *  2. Local rows are untouched; this computer is home.
 *
 * An OFFLINE machine keeps its rows (greyed by the renderer): a vanished row
 * would take the only record of where the work was.
 */

import type { MachineRowState, RemoteMark, TreeRow } from "./tree-core"

/** One registered machine, as this layer needs it. */
export interface MachineLayerEntry {
  readonly alias: string
  /** Remote hostname when known, else the alias. */
  readonly hostLabel: string
  readonly state: MachineRowState
  readonly version?: string
}

/** i18n key for a machine's state word; null when online.
 *  A key, not a string, so the language isn't frozen here. */
export function machineStateKey(state: MachineRowState): string | null {
  switch (state) {
    case "online":
      return null
    case "connecting":
      return "tasks.machine.connecting"
    case "unsupported":
      return "tasks.machine.unsupported"
    case "mismatch":
      return "tasks.machine.mismatch"
    default:
      return "tasks.machine.offline"
  }
}

/**
 * Where a remote row lives, for the row the cursor is on: `on mac-mini · v0.9.185`
 * when online (version skew explains most cross-machine "bugs"), else
 * `on mac-mini · offline` / `on mac-mini · protocol mismatch`.
 */
export function remoteRowCaption(
  mark: RemoteMark,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  const where = t("tasks.machine.runsOn", { host: mark.host })
  const word = machineStateKey(mark.state)
  if (word) return `${where} · ${t(word)}`
  return mark.version ? `${where} · v${mark.version}` : where
}

/** A remote row reads as live only while its machine is online. */
export function remoteMarkLive(mark: RemoteMark): boolean {
  return mark.state === "online"
}

/**
 * Stamp each worktree row of a remote task with its machine (host + state).
 * Rows of an unregistered machine (mid-removal) are dropped, and a project
 * header left with nothing under it goes with them — a stranded header would
 * read as an empty local project.
 */
export function applyMachineLayer(
  rows: readonly TreeRow[],
  machines: readonly MachineLayerEntry[],
): readonly TreeRow[] {
  if (machines.length === 0) return rows
  const byAlias = new Map(machines.map((entry) => [entry.alias, entry]))
  const kept: TreeRow[] = []
  // Index of the current project header in `kept`, and whether a row it had dropped.
  let header = -1
  let dropped = false
  const closeHeader = (): void => {
    if (header >= 0 && dropped && header === kept.length - 1) kept.pop()
  }
  for (const row of rows) {
    if (row.kind === "project") {
      closeHeader()
      header = kept.length
      dropped = false
      kept.push(row)
      continue
    }
    if (row.kind === "routines" || row.kind === "recent") {
      kept.push(row)
      continue
    }
    const alias = row.task.origin?.machineId ?? "local"
    if (alias === "local") {
      kept.push(row)
      continue
    }
    const entry = byAlias.get(alias)
    if (!entry) {
      dropped = true
      continue
    }
    kept.push({
      ...row,
      remote: {
        host: entry.hostLabel || row.task.origin?.hostLabel || alias,
        state: entry.state,
        ...(entry.version ? { version: entry.version } : {}),
      },
    })
  }
  closeHeader()
  return kept
}
