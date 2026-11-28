/**
 * Machine labels (TUI `machine-layer.ts`): `narwhal · v0.9.185`, `narwhal · offline`,
 * `narwhal · ⚠ v0.9.100 (protocol mismatch)`; in the rail they are the hover text of a remote task's
 * cloud mark, its row greyed unless online so a stale snapshot never reads as live. The state is the bridge's `machines.list`; each machine's tasks come in the task feed.
 */

import type { en as tasksEn } from "@sma1lboy/rove-core/i18n/messages/tasks.ts"
import { useEffect, useState } from "react"
import { everyVisible } from "./every-visible.ts"
import { t, useLocale } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import type { NavRow } from "./rail.ts"
import { lastReply, requestRemembered } from "./remembered.ts"
import { useStore } from "./store.ts"
import { hideTip, showTip } from "./tooltip.ts"
import { tc } from "./tui-copy.ts"
import { Button } from "./ui/button.tsx"
import { CLOUD_ICON, CLOUD_MARK } from "./ui/rail.ts"
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

/** A task row from another machine, or working in a workspace on one, gets a cloud mark with this text; other rows, headers and tab rows get none. */
export function rowCloud(
  row: NavRow,
  machines: readonly MachineRow[],
  words: (typeof tasksEn)["machine"],
): string | null {
  if (row.kind !== "task") return null
  const alias = row.machine ?? row.task.workspaceOn
  if (alias === undefined) return null
  return remoteLabel(
    alias,
    machines.find((m) => m.alias === alias),
    words,
    row.task.machine?.label,
  )
}

/**
 * The small cloud on a remote task's row, the only place the rail says a task lives elsewhere
 * (the bottom status line names this machine once). `label` is {@link remoteLabel}; it shows at once
 * beside the mark, where the row's PR list and title tip open. `onOpen` drops the row's title tip.
 */
export function CloudMark({ label, onOpen }: { label: string; onOpen?: () => void }) {
  return (
    <span
      className={CLOUD_MARK}
      role="img"
      aria-label={label}
      onPointerEnter={(e) => {
        if (e.pointerType === "touch") return
        onOpen?.()
        showTip(e.currentTarget, label, "right")
      }}
      onPointerLeave={hideTip}
    >
      {/* Three arcs, mirrored: a big bump between two small ones. */}
      <svg className={CLOUD_ICON} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6.25 18.5A3.75 3.75 0 0 1 7.34 11.16A4.75 4.75 0 0 1 16.66 11.16A3.75 3.75 0 0 1 17.75 18.5Z" />
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
