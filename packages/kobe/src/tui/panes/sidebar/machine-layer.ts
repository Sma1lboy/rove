/**
 * The MACHINE layer of the sidebar tree.
 *
 * `buildTreeRows` already groups every task under its project, and a project's
 * key now carries the machine it lives on — so all this pass has to do is
 * gather each remote machine's project subtrees behind one header and indent
 * them by one.
 *
 * Two rules the whole feature rests on:
 *
 *  1. **Zero machines changes nothing.** With no machines registered, this
 *     returns the SAME array it was given — identity included — so a sidebar
 *     golden recorded before machines existed still matches byte for byte.
 *  2. **The local machine gets no header.** Its projects stay at depth 0 where
 *     they have always been. Adding a `local` header would cost every row on
 *     the machine everybody actually uses one level of indent to state
 *     something the absence of a header already says.
 *
 * An OFFLINE machine keeps its rows. They grey out (the renderer's job), but
 * they do not disappear: a laptop with a closed lid has not stopped having
 * those tasks, and a row that vanishes takes with it the only record of where
 * the work was.
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

/**
 * The i18n key for a machine's state word, or null when the machine is up (an
 * online machine says its VERSION, which needs no translation).
 *
 * A key rather than a rendered string: this module is pure and the renderer
 * owns the translator, so composing English here would freeze the label in one
 * language the way a module-level `t()` constant does.
 */
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
 * What a machine header reads as, given a translator: `narwhal · v0.9.185`,
 * `narwhal · offline`, or `narwhal · ⚠ v0.9.100 (protocol mismatch)`.
 *
 * The version is on the row deliberately. Two machines running different Rove
 * builds is the normal state of a fleet, and it explains most of what looks
 * like a bug across one — so it belongs where the machine is named rather than
 * behind a command.
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
 * Insert a header per remote machine and indent that machine's rows under it.
 *
 * `rows` is the flat list `buildTreeRows` produced from the MERGED task list,
 * so every row already knows its machine (a project row states it; a worktree
 * or tab row inherits it from the project header above). Rows of a machine
 * with no registered entry are dropped rather than rendered loose — that is a
 * machine mid-removal, and a headerless remote project reads as a local one.
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
  // Registration order, not connection order: a machine's place in the tree
  // must not move because it woke up before another one.
  for (const entry of machines) {
    // A machine still handshaking contributes its header and no rows — the
    // header's own label is what says so.
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
