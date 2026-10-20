/**
 * Machine headers in the rail (TUI `machine-layer.ts`): `narwhal · v0.9.185`, `narwhal · offline`,
 * `narwhal · ⚠ v0.9.100 (protocol mismatch)`, greyed unless online so a stale snapshot never reads
 * as live. The state is the bridge's `machines.list`; each machine's tasks come in the task feed.
 */

import type { en as tasksEn } from "@sma1lboy/rove/src/tui/i18n/messages/tasks.ts"
import { useEffect, useState } from "react"
import { useLocale } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { useStore } from "./store.ts"
import { tc } from "./tui-copy.ts"

export interface MachineRow {
  readonly alias: string
  readonly hostLabel: string
  readonly state: "connecting" | "online" | "offline" | "unsupported" | "mismatch"
  readonly version: string | null
}

/** Machines change state on SSH timescales; the bridge holds the hub's latest. */
const POLL_MS = 10_000

/** TUI `machineRowLabel`. */
export function machineLabel(row: MachineRow, words: (typeof tasksEn)["machine"]): string {
  const name = row.hostLabel || row.alias
  if (row.state === "online") return row.version ? `${name} · v${row.version}` : name
  const word = words[row.state]
  if (row.state === "mismatch") return row.version ? `${name} · ⚠ v${row.version} (${word})` : `${name} · ⚠ ${word}`
  return `${name} · ${word}`
}

export function MachineHead({ row, words }: { row: MachineRow; words: (typeof tasksEn)["machine"] }) {
  return (
    <h2 className={`machine-head ${row.state === "online" ? "" : "is-stale"}`} title={row.alias}>
      <span>{machineLabel(row, words)}</span>
      <span className="rule" />
    </h2>
  )
}

/** What the TUI's Files pane says for a task whose worktree is on another machine (`host-files-pane.tsx`). */
export function RemoteNotice({ host }: { host: string }) {
  useLocale()
  return (
    <div className="remote-notice">
      <p className="muted">{tc("tasks", "machine.filesElsewhere", { host })}</p>
      <p className="muted">{tc("tasks", "machine.filesHint", { host })}</p>
    </div>
  )
}

/** Registered machines, reread when the feed says one of them changed reachability. */
export function useMachines(model: AppModel): readonly MachineRow[] {
  const conn = useStore(model.client.conn)
  const remote = useStore(model.remote)
  const [rows, setRows] = useState<readonly MachineRow[]>([])
  const reachability = [...new Set(remote.map((task) => `${task.machine?.id}:${task.machine?.stale ?? false}`))].join()
  // biome-ignore lint/correctness/useExhaustiveDependencies: reachability is a refetch trigger the body doesn't read
  useEffect(() => {
    if (conn.state !== "open") return
    let live = true
    const load = () =>
      model.client.request<{ machines: MachineRow[] }>("machines.list").then(
        (r) => live && setRows(r.machines),
        () => {},
      )
    void load()
    const timer = window.setInterval(load, POLL_MS)
    return () => {
      live = false
      window.clearInterval(timer)
    }
  }, [model.client, conn.state, reachability])
  return rows
}
