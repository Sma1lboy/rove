/**
 * Machine labels (TUI `machine-layer.ts`): `narwhal · v0.9.185`, `narwhal · offline`,
 * `narwhal · ⚠ v0.9.100 (protocol mismatch)`; in the rail they are the hover text of a remote task's
 * cloud mark, its row greyed unless online so a stale snapshot never reads as live. The state is the bridge's `machines.list`; each machine's tasks come in the task feed.
 */

import type { en as tasksEn } from "@sma1lboy/rove/src/tui/i18n/messages/tasks.ts"
import { useEffect, useState } from "react"
import { useLocale } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import type { NavRow } from "./rail.ts"
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

/**
 * The cloud mark's hover and aria text on a task that lives on another machine: `on mac` while it is
 * online, then its trouble (`on mac · offline`, `on mac · ⚠ v0.9.100 (protocol mismatch)`). A machine
 * the list has not loaded yet reads as just its name.
 */
export function remoteLabel(
  alias: string,
  row: MachineRow | undefined,
  words: (typeof tasksEn)["machine"],
  fallback = alias,
): string {
  const name = row ? row.hostLabel || row.alias : fallback
  const on = words.runsOn.replace("{host}", name)
  if (!row || row.state === "online") return on
  const full = machineLabel(row, words)
  return `${on}${full.slice(name.length)}`
}

/** A task row from another machine gets a cloud mark with this text; this machine's rows, headers and tab rows get none. */
export function rowCloud(
  row: NavRow,
  machines: readonly MachineRow[],
  words: (typeof tasksEn)["machine"],
): string | null {
  if (row.kind !== "task" || row.machine === undefined) return null
  const alias = row.machine
  return remoteLabel(
    alias,
    machines.find((m) => m.alias === alias),
    words,
    row.task.machine?.label,
  )
}

/**
 * The small cloud after a remote task's title, the only place the rail says a task lives elsewhere
 * (the bottom status line names this machine once). `label` is {@link remoteLabel}.
 */
export function CloudMark({ label }: { label: string }) {
  return (
    <span className="cloud-mark" title={label} role="img" aria-label={label}>
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
        <path
          d="M4.5 13a3 3 0 0 1-.4-5.97A4.5 4.5 0 0 1 12.8 6.6 3.2 3.2 0 0 1 12.3 13Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </svg>
    </span>
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
