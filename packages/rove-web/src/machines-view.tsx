/**
 * Machine headers under the local rows (TUI `machine-layer.ts`): `narwhal · v0.9.185`,
 * `narwhal · offline`, `narwhal · ⚠ v0.9.100 (protocol mismatch)`, greyed unless online so a
 * stale snapshot never reads as live. Read-only, from the bridge's `machines.list`.
 */

import { en as tasksEn, zh as tasksZh } from "@sma1lboy/rove/src/tui/i18n/messages/tasks.ts"
import { useEffect, useState } from "react"
import type { BridgeClient } from "./bridge.ts"
import { useLocale } from "./i18n/index.ts"
import { useStore } from "./store.ts"

interface MachineRow {
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

export function MachineHeaders({ client }: { client: BridgeClient }) {
  const words = (useLocale() === "zh" ? tasksZh : tasksEn).machine
  const conn = useStore(client.conn)
  const [rows, setRows] = useState<readonly MachineRow[]>([])
  useEffect(() => {
    if (conn.state !== "open") return
    let live = true
    const load = () =>
      client.request<{ machines: MachineRow[] }>("machines.list").then(
        (r) => live && setRows(r.machines),
        () => {},
      )
    void load()
    const timer = window.setInterval(load, POLL_MS)
    return () => {
      live = false
      window.clearInterval(timer)
    }
  }, [client, conn.state])
  return rows.map((row) => (
    <h2 key={row.alias} className={`machine-head ${row.state === "online" ? "" : "is-stale"}`} title={row.alias}>
      <span>{machineLabel(row, words)}</span>
      <span className="rule" />
    </h2>
  ))
}
