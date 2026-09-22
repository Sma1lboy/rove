/**
 * The MACHINE layer of the sidebar tree: gathers each remote machine's
 * project subtrees (project keys carry the machine) behind one header,
 * indented by one.
 *
 *  1. Zero machines → returns the SAME array (identity included), so
 *     machine-free sidebar goldens match byte for byte.
 *  2. The local machine gets no header; its projects stay at depth 0.
 *
 * An OFFLINE machine keeps its rows (greyed by the renderer): a vanished row
 * would take the only record of where the work was.
 */

import { type MachineRowState, type TreeRow, machineRowId } from "./tree-core"

/** One registered machine, as this layer needs it. */
export interface MachineLayerEntry {
  readonly alias: string
  /** Remote hostname when known, else the alias. */
  readonly hostLabel: string
  readonly state: MachineRowState
  readonly version?: string
}

/** i18n key for a machine's state word; null when online (shows its version).
 *  A key, not a string, so the language isn't frozen here. */
function machineStateKey(state: MachineRowState): string | null {
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
 * Machine header text: `narwhal · v0.9.185`, `narwhal · offline`, or
 * `narwhal · ⚠ v0.9.100 (protocol mismatch)`. The version is on the row
 * because version skew explains most cross-machine "bugs".
 */
export function machineRowLabel(entry: MachineLayerEntry, t: (key: string) => string): string {
  const name = entry.hostLabel || entry.alias
  const word = machineStateKey(entry.state)
  if (!word) return entry.version ? `${name} · v${entry.version}` : name
  if (entry.state === "mismatch") {
    return entry.version ? `${name} · ⚠ v${entry.version} (${t(word)})` : `${name} · ⚠ ${t(word)}`
  }
  return `${name} · ${t(word)}`
}

/**
 * Insert a header per remote machine and indent its rows under it. Non-project
 * rows inherit the machine of the project row above. Rows of an unregistered
 * machine (mid-removal) are dropped — headerless they'd read as local.
 */
export function applyMachineLayer(
  rows: readonly TreeRow[],
  machines: readonly MachineLayerEntry[],
): readonly TreeRow[] {
  if (machines.length === 0) return rows
  const byAlias = new Map(machines.map((entry) => [entry.alias, entry]))
  const local: TreeRow[] = []
  const remote = new Map<string, TreeRow[]>()
  let current = "local"
  for (const row of rows) {
    if (row.kind === "machine") continue
    if (row.kind === "project") current = row.machineId
    if (current === "local") {
      local.push(row)
      continue
    }
    if (!byAlias.has(current)) continue
    const bucket = remote.get(current) ?? []
    bucket.push({ ...row, depth: row.depth + 1 } as TreeRow)
    remote.set(current, bucket)
  }
  const out: TreeRow[] = [...local]
  // Registration order, so a machine doesn't move by waking up first.
  for (const entry of machines) {
    // A handshaking machine shows just its header.
    out.push({
      kind: "machine",
      id: machineRowId(entry.alias),
      alias: entry.alias,
      label: entry.hostLabel || entry.alias,
      state: entry.state,
      ...(entry.version ? { version: entry.version } : {}),
      depth: 0,
    })
    for (const row of remote.get(entry.alias) ?? []) out.push(row)
  }
  return out
}
