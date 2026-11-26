/**
 * Machine labels (TUI `machine-layer.ts`): `narwhal · v0.9.185`, `narwhal · offline`,
 * `narwhal · ⚠ v0.9.100 (protocol mismatch)`; in the rail they are the hover text of a remote task's
 * cloud mark, its row greyed unless online so a stale snapshot never reads as live. The state is the bridge's `machines.list`; each machine's tasks come in the task feed.
 */

import { CLOUD_DOT_ROWS } from "@sma1lboy/rove/src/lib/cloud-dots.ts"
import type { en as tasksEn } from "@sma1lboy/rove/src/tui/i18n/messages/tasks.ts"
import { useEffect, useState } from "react"
import { everyVisible } from "./every-visible.ts"
import { t, useLocale } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import type { NavRow } from "./rail.ts"
import { lastReply, requestRemembered } from "./remembered.ts"
import { useStore } from "./store.ts"
import { tc } from "./tui-copy.ts"
import { Button } from "./ui/button.tsx"
import { CLOUD_MARK } from "./ui/rail.ts"
import { REMOTE_NOTICE } from "./ui/shell.ts"

export interface MachineRow {
  readonly alias: string
  readonly hostLabel: string
  readonly state: "connecting" | "online" | "offline" | "unsupported" | "mismatch"
  readonly version: string | null
  /** Why it is not online (`refused`, `auth-denied`, `lost`…); absent from an older bridge. */
  readonly reason?: string | null
  /** It runs an older Rove than this machine; absent from an older bridge. */
  readonly behind?: boolean
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
 * The cloud mark's hover and aria text on a task that lives on another machine: its registered name,
 * then its hostname when different (`on mac (Mac.lan)`) while it is online, then its trouble (`on mac · offline`, `on mac · ⚠ v0.9.100 (protocol mismatch)`). A machine
 * the list has not loaded yet reads as just its name.
 */
export function remoteLabel(
  alias: string,
  row: MachineRow | undefined,
  words: (typeof tasksEn)["machine"],
  fallback = alias,
): string {
  // The name the machine was registered under (`rove machine add … <alias>`), then its hostname when that differs.
  const host = row?.hostLabel && row.hostLabel !== alias ? ` (${row.hostLabel})` : ""
  const on = words.runsOn.replace("{host}", row ? `${alias}${host}` : fallback)
  if (!row || row.state === "online") return on
  const full = machineLabel(row, words)
  return `${on}${full.slice((row.hostLabel || row.alias).length)}`
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

/** The cloud's outline (`cloud-dots.ts`): 1.5px dots at a 2px pitch, half the status mark's grain. */
const CLOUD_DOTS = CLOUD_DOT_ROWS.flatMap((row, y) =>
  [...row].flatMap((cell, x) => (cell === "#" ? [[x, y] as const] : [])),
)

/**
 * The small cloud on a remote task's row, the only place the rail says a task lives elsewhere
 * (the bottom status line names this machine once). `label` is {@link remoteLabel}.
 */
export function CloudMark({ label }: { label: string }) {
  return (
    <span className={CLOUD_MARK} title={label} role="img" aria-label={label}>
      <svg viewBox="0 0 11.5 7.5" width="11.5" height="7.5" fill="currentColor" aria-hidden="true">
        {CLOUD_DOTS.map(([x, y]) => (
          <circle key={`${x}.${y}`} cx={x * 2 + 0.75} cy={y * 2 + 0.75} r="0.75" />
        ))}
      </svg>
    </span>
  )
}

/** What the TUI's Files pane says for a task whose worktree is on another machine (`host-files-pane.tsx`). */
export function RemoteNotice({ host, onMachines }: { host: string; onMachines: () => void }) {
  useLocale()
  return (
    <div className={REMOTE_NOTICE}>
      <p className="text-muted">{tc("tasks", "machine.filesElsewhere", { host })}</p>
      <p className="text-muted">{tc("tasks", "machine.filesHint", { host })}</p>
      <div>
        <Button hit="tight" onClick={onMachines}>
          {t("machines.open")}
        </Button>
      </div>
    </div>
  )
}

/** Registered machines, reread when the feed says one of them changed reachability. */
export function useMachines(model: AppModel): readonly MachineRow[] {
  const conn = useStore(model.client.conn)
  const remote = useStore(model.remote)
  const [rows, setRows] = useState<readonly MachineRow[]>(
    () => lastReply<{ machines: MachineRow[] }>(model, "machines.list")?.machines ?? [],
  )
  const reachability = [...new Set(remote.map((task) => `${task.machine?.id}:${task.machine?.stale ?? false}`))].join()
  // biome-ignore lint/correctness/useExhaustiveDependencies: reachability is a refetch trigger the body doesn't read
  useEffect(() => {
    if (conn.state !== "open") return
    let live = true
    const load = () =>
      requestRemembered<{ machines: MachineRow[] }>(model, "machines.list").then(
        (r) => live && setRows(r.machines),
        () => {},
      )
    void load()
    const stop = everyVisible(POLL_MS, load)
    return () => {
      live = false
      stop()
    }
  }, [model.client, conn.state, reachability])
  return rows
}
