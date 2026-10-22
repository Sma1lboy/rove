/**
 * This TUI's copy of the daemon's row status (`row-status-store.ts`), and its
 * two reports back. The daemon decides what every task and tab shows (running,
 * needs input, attention, unseen, idle, busy); the sidebar and the tab strip
 * read it here and draw it with `rowStatusGlyph`. Nothing in the TUI derives a
 * status of its own.
 *
 * The TUI tells the daemon only what it alone knows:
 * - which task and tab is on screen (`ui.viewing`): a viewed tab never shows
 *   unseen, and viewing it reads its inbox episode for every client;
 * - that the user answered a question (`activity.answered`): its `?` clears
 *   until the engine reports again.
 *
 * `row.status` carries the whole snapshot each time; the newest `rev` wins.
 * Replay only holds the last value and a dropped socket misses events, so the
 * snapshot is re-listed on attach and after every reconnect, and the viewing
 * report (which the daemon drops with the connection) is re-sent.
 */

import { logClientError } from "@sma1lboy/rove-daemon/client/client-log"
import {
  type RowStatus,
  type TabStatus,
  type TaskStatus,
  tabStatus,
  taskStatus,
} from "@sma1lboy/rove-daemon/daemon/row-status"
import type { RowStatusPayload } from "@sma1lboy/rove-daemon/daemon/row-status-store"
import { useEffect, useSyncExternalStore } from "react"
import type { RowStatusTransport } from "../../client/remote-orchestrator-row-status"
import type { TaskActivityState } from "../../engine/hook-events"
import { createStateCell } from "../../lib/external-store"

export type RowStatusMap = Readonly<Record<string, TaskStatus>>

const EMPTY: RowStatusMap = {}

/**
 * taskId → the status for the task and each of its tabs: this machine's
 * daemon's snapshot, plus other machines' tasks (`acceptRemoteActivity`) for
 * ids the snapshot does not have.
 */
export const rowStatusCell = createStateCell<RowStatusMap>(EMPTY, "row.status")

let transport: RowStatusTransport | null = null
let rev = -1
/** The local daemon's last snapshot, and the statuses built for other machines' tasks. */
let local: RowStatusMap = EMPTY
let remote: RowStatusMap = EMPTY
/** The last `ui.viewing` sent, re-sent after a reconnect; undefined = never sent. */
let viewing: { taskId: string | null; tabId: string | null } | undefined

/** Merge both sources into the cell. Unchanged tasks keep their object, so a row
 *  reading one task re-renders only when that task moved. */
function publish(): void {
  const prev = rowStatusCell.get()
  const next: Record<string, TaskStatus> = {}
  for (const [taskId, status] of Object.entries(remote)) if (!(taskId in local)) next[taskId] = status
  for (const [taskId, status] of Object.entries(local)) next[taskId] = status
  let changed = Object.keys(prev).length !== Object.keys(next).length
  for (const [taskId, status] of Object.entries(next)) {
    const old = prev[taskId]
    if (old !== undefined && JSON.stringify(old) === JSON.stringify(status)) next[taskId] = old
    else changed = true
  }
  if (changed) rowStatusCell.set(next)
}

/**
 * Take a snapshot. `force` (a fresh `status.list`) skips the rev check: a
 * restarted daemon counts from zero again.
 */
export function acceptRowStatus(payload: RowStatusPayload, force = false): void {
  if (!force && payload.rev < rev) return
  rev = payload.rev
  local = payload.tasks
  publish()
}

/** One engine-state reading as the hub relays it (`TaskEngineState`'s slice). */
interface RelayedActivity {
  readonly state: TaskActivityState
  readonly at: number
}

/**
 * Other machines' tasks. Their daemons' `row.status` does not reach this TUI;
 * the hub relays their `engine-state` instead (per task, and per tab when it
 * has it). Their status is the daemon's own rule (`tabStatus` / `taskStatus`)
 * applied to that reading, with nothing this TUI could know about them:
 * nobody here views them, no inbox, no PTY host session.
 */
export function remoteRowStatus(
  activity: ReadonlyMap<string, RelayedActivity>,
  tabActivity?: ReadonlyMap<string, ReadonlyMap<string, RelayedActivity>>,
): RowStatusMap {
  const out: Record<string, TaskStatus> = {}
  for (const taskId of new Set([...activity.keys(), ...(tabActivity?.keys() ?? [])])) {
    const tabs: Record<string, TabStatus> = {}
    for (const [tabId, entry] of tabActivity?.get(taskId) ?? []) {
      tabs[tabId] = tabStatus({ activity: { state: entry.state, at: entry.at }, viewed: false })
    }
    const entry = activity.get(taskId)
    // Per-tab readings carry the task; the task-level one stands in only when there are none.
    const tabless =
      entry && Object.keys(tabs).length === 0
        ? tabStatus({ activity: { state: entry.state, at: entry.at }, viewed: false })
        : undefined
    out[taskId] = { task: taskStatus(tabs, tabless ? { tabless } : {}), tabs }
  }
  return out
}

/** Take the hub's latest relay of other machines' engine state. */
export function acceptRemoteActivity(
  activity: ReadonlyMap<string, RelayedActivity>,
  tabActivity?: ReadonlyMap<string, ReadonlyMap<string, RelayedActivity>>,
): void {
  remote = remoteRowStatus(activity, tabActivity)
  publish()
}

/** Follow a hub's relay (`MachineFeed.liveSignal`); returns the unsubscribe. */
export function followRemoteActivity(live: {
  get(): {
    readonly activity: ReadonlyMap<string, RelayedActivity>
    readonly tabActivity?: ReadonlyMap<string, ReadonlyMap<string, RelayedActivity>>
  }
  subscribe(listener: () => void): () => void
}): () => void {
  const take = () => {
    const { activity, tabActivity } = live.get()
    acceptRemoteActivity(activity, tabActivity)
  }
  take()
  const off = live.subscribe(take)
  return () => {
    off()
    acceptRemoteActivity(new Map())
  }
}

/** The task's rollup: what a row whose tabs are not listed shows. */
export function taskRowStatus(map: RowStatusMap, taskId: string): RowStatus | undefined {
  return map[taskId]?.task
}

export function tabRowStatus(map: RowStatusMap, taskId: string, tabId: string): TabStatus | undefined {
  return map[taskId]?.tabs[tabId]
}

const read = () => rowStatusCell.get()

/** The whole map; re-renders on any change. */
export function useRowStatusMap(): RowStatusMap {
  return useSyncExternalStore(rowStatusCell.subscribe, read, read)
}

/** One task's rollup; re-renders only when that task's status moved. */
export function useTaskRowStatus(taskId: string): RowStatus | undefined {
  const pick = () => taskRowStatus(rowStatusCell.get(), taskId)
  return useSyncExternalStore(rowStatusCell.subscribe, pick, pick)
}

/** One tab's status; re-renders only when its task's status moved. */
export function useTabRowStatus(taskId: string, tabId: string): TabStatus | undefined {
  const pick = () => tabRowStatus(rowStatusCell.get(), taskId, tabId)
  return useSyncExternalStore(rowStatusCell.subscribe, pick, pick)
}

function sendViewing(): void {
  if (!transport || viewing === undefined) return
  void transport.viewing(viewing.taskId, viewing.tabId).catch((err) => logClientError("row-status", err))
}

/** Tell the daemon what this TUI shows now; `taskId: null` = no workspace on screen. Deduplicated. */
export function reportViewing(taskId: string | null, tabId: string | null): void {
  const next = { taskId, tabId: taskId === null ? null : tabId }
  if (viewing && viewing.taskId === next.taskId && viewing.tabId === next.tabId) return
  viewing = next
  sendViewing()
}

/** The user answered the question `tabId` was waiting on. */
function reportAnswered(taskId: string, tabId: string): void {
  void transport?.answered(taskId, tabId).catch((err) => logClientError("row-status", err))
}

/**
 * One raw write into an engine tab. Enter (`\r`, or a paste ending in one) at
 * a tab the daemon shows waiting on the user is an answer: an AskUserQuestion
 * answer resumes the SAME turn, so no hook says so, and only this TUI saw it.
 * An enter anywhere else is an ordinary submit the engine reports itself.
 */
export function noteAnswerInput(data: string, taskId: string, tabId: string): void {
  if (data !== "\r" && !data.endsWith("\r")) return
  if (tabRowStatus(rowStatusCell.get(), taskId, tabId)?.kind !== "needs-input") return
  reportAnswered(taskId, tabId)
}

/** (Re)load the snapshot and re-send what this TUI is viewing: on attach and after a reconnect. */
export async function reloadRowStatus(): Promise<void> {
  const current = transport
  if (!current) return
  sendViewing()
  try {
    acceptRowStatus(await current.list(), true)
  } catch (err) {
    logClientError("row-status", err)
  }
}

/** Wire this TUI to a daemon (or detach with null). */
export function attachRowStatusTransport(next: RowStatusTransport | null): () => void {
  transport = next
  rev = -1
  if (!next) return () => {}
  const off = next.onChanged((payload) => acceptRowStatus(payload))
  void reloadRowStatus()
  return () => {
    off()
    if (transport === next) transport = null
  }
}

/** Test seam: drop all state; `seed` installs a snapshot as if the daemon had sent it. */
export function resetRowStatusForTests(seed?: RowStatusMap): void {
  transport = null
  rev = -1
  viewing = undefined
  local = seed ?? EMPTY
  remote = EMPTY
  rowStatusCell.set(local)
}

/** Once per host: follow the daemon's row status, and catch up after every reconnect. */
export function useRowStatusSync(
  channel: RowStatusTransport,
  connection: { (): string; subscribe(listener: () => void): () => void },
): void {
  useEffect(() => {
    // A host without a daemon line (a stub orchestrator) must not detach another's.
    if (!channel) return
    const detach = attachRowStatusTransport(channel)
    let last = connection()
    const off = connection.subscribe(() => {
      const now = connection()
      if (now === "online" && last !== "online") void reloadRowStatus()
      last = now
    })
    return () => {
      off()
      detach()
    }
  }, [channel, connection])
}

/**
 * Report the task and tab this surface shows while it is mounted, and "none"
 * when it unmounts (a page took the content pane, the layout hid it).
 */
export function useViewingReport(taskId: string | null, tabId: string | null): void {
  useEffect(() => {
    reportViewing(taskId, tabId)
  }, [taskId, tabId])
  useEffect(() => () => reportViewing(null, null), [])
}
