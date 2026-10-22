/**
 * This TUI's view of the daemon-owned terminal tabs (`tabs-store.ts`).
 *
 * The daemon is the only writer. Per task this module keeps the last state the
 * daemon confirmed (newest `rev` wins, from `tabs.list`, a reply, or a
 * `tabs.changed`) plus this TUI's operations still in flight, and shows the
 * one folded over the other (`applyTabOps`): a local change paints at once,
 * and once the daemon answers, the daemon's version replaces it. Every writer
 * goes through {@link commitTaskTabs} with the state its reducer produced; the
 * diff becomes ops (`diffTabs`).
 *
 * Ids never collide: a mounted task holds ordinals the daemon reserved for this
 * TUI ({@link ensureTabReservation}), and the reducers mint from them, so a
 * new tab needs no round trip and no other client can mint the same id.
 *
 * Which tab this TUI looks at is its own (`activeId`); the daemon only keeps
 * the last one focused anywhere, as a starting point.
 */

import { logClientError } from "@sma1lboy/rove-daemon/client/client-log"
import type { SharedTabs, TabOp, TabRow } from "@sma1lboy/rove-daemon/daemon/tabs-ops"
import { applyTabOps, diffTabs } from "@sma1lboy/rove-daemon/daemon/tabs-ops"
import { useEffect } from "react"
import type { TabsTransport } from "../../client/remote-orchestrator-tabs"
import { createStateCell } from "../../lib/external-store"
import type { TabsState, TerminalTab } from "../../tui/workspace/terminal-tabs-core"

/** Per-task tab state as this TUI renders it: the daemon's tabs, this TUI's own active tab.
 *
 *  Written only here (`publish`), so a write is always a daemon-backed one; a raw Map
 *  mutation would also be invisible to React, and `ShowWorkspace` decides whether to mount
 *  `TerminalTabs` from this map. */
export const tabsByTask = new Map<string, TabsState>()

/** Bumped on every `tabsByTask` change so React readers re-render; a counter, not a copy. */
export const tabsRevision = createStateCell(0, "tabs.revision")

function setTaskTabs(taskId: string, state: TabsState): void {
  tabsByTask.set(taskId, state)
  tabsRevision.update((n) => n + 1)
}

function deleteTaskTabs(taskId: string): void {
  if (!tabsByTask.delete(taskId)) return
  tabsRevision.update((n) => n + 1)
}

interface TaskTabs {
  confirmed: SharedTabs | null
  rev: number
  pending: { readonly seq: number; readonly ops: readonly TabOp[] }[]
  /** Ordinals the daemon reserved for this TUI, lowest first; the reducers mint from the head. */
  reserved: number[]
  reserving: boolean
  /** This TUI's own active tab, and where it sat (to fall to a neighbour when another client closes it). */
  active: { id: string; index: number } | null
}

const RESERVE_BLOCK = 2

let transport: TabsTransport | null = null
let loaded = false
let seq = 0
const tasks = new Map<string, TaskTabs>()

function entry(taskId: string): TaskTabs {
  let task = tasks.get(taskId)
  if (!task) {
    task = { confirmed: null, rev: 0, pending: [], reserved: [], reserving: false, active: null }
    tasks.set(taskId, task)
  }
  return task
}

/** True once the daemon's tabs arrived (`tabs.list`): before that, "no record" may only mean "not loaded". */
export function tabsLoaded(): boolean {
  return loaded
}

/** The shared tabs this TUI shows for `taskId`: confirmed state with its in-flight ops folded on top. */
function sharedView(task: TaskTabs): SharedTabs | null {
  let state = task.confirmed
  for (const batch of task.pending) state = applyTabOps(state, batch.ops).state
  return state
}

function activeIn(task: TaskTabs, view: SharedTabs): string {
  const tabs = view.tabs
  const mine = task.active
  if (mine && tabs.some((t) => t.id === mine.id)) return mine.id
  // Another client closed the tab this one was on: its left neighbour, as a local close would.
  if (mine && tabs.length > 0) return (tabs[Math.max(0, Math.min(mine.index, tabs.length) - 1)] ?? tabs[0]).id
  if (view.activeId && tabs.some((t) => t.id === view.activeId)) return view.activeId
  return tabs[0]?.id ?? mine?.id ?? ""
}

/** The TabsState the UI renders: the shared view plus this TUI's active tab and minting counter. */
function uiState(task: TaskTabs, view: SharedTabs): TabsState {
  const activeId = activeIn(task, view)
  return {
    tabs: view.tabs as unknown as TerminalTab[],
    activeId,
    nextOrdinal: task.reserved[0] ?? view.nextOrdinal,
    ...(view.reopenAs !== undefined ? { reopenAs: view.reopenAs as TabsState["reopenAs"] } : {}),
  }
}

/** Recompute and publish `taskId`'s UI state (the sidebar, a mounted TerminalTabs, the inbox read it). */
function publish(taskId: string): TabsState | null {
  const task = entry(taskId)
  const view = sharedView(task)
  if (!view) {
    if (task.confirmed === null && task.pending.length === 0 && loaded) deleteTaskTabs(taskId)
    return null
  }
  const ui = uiState(task, view)
  // A remount's `tabs.reserve` reply usually changes nothing shown; republishing it would wake
  // every `tabsRevision` reader on each task switch.
  const shown = tabsByTask.get(taskId)
  if (shown && sameUiState(shown, ui)) return shown
  setTaskTabs(taskId, ui)
  return ui
}

function sameUiState(a: TabsState, b: TabsState): boolean {
  return a.tabs === b.tabs && a.activeId === b.activeId && a.nextOrdinal === b.nextOrdinal && a.reopenAs === b.reopenAs
}

function toShared(state: TabsState): SharedTabs {
  return {
    tabs: state.tabs as unknown as TabRow[],
    nextOrdinal: state.nextOrdinal,
    ...(state.reopenAs !== undefined ? { reopenAs: state.reopenAs } : {}),
  }
}

function accept(taskId: string, state: SharedTabs | null, rev: number): void {
  const task = entry(taskId)
  if (rev < task.rev) return
  task.confirmed = state
  task.rev = rev
}

function send(taskId: string, ops: readonly TabOp[]): void {
  const task = entry(taskId)
  const batch = { seq: ++seq, ops }
  task.pending.push(batch)
  const done = (): void => {
    task.pending = task.pending.filter((b) => b !== batch)
    publish(taskId)
  }
  if (!transport) {
    // Not attached (render tests, a TUI without a daemon): the view is all there is.
    accept(taskId, sharedView(task), task.rev)
    task.pending = task.pending.filter((b) => b !== batch)
    return
  }
  transport
    .apply(taskId, ops)
    .then((reply) => {
      accept(taskId, reply.state, reply.rev)
      done()
    })
    .catch((err) => {
      logClientError("tabs", err)
      done()
    })
}

/**
 * Write `next` (what a reducer made of `base`, this TUI's state at the time;
 * default the current view) through the daemon. Paints at once; the daemon's
 * answer settles it. Returns the state to render now.
 */
export function commitTaskTabs(taskId: string, next: TabsState, base?: TabsState): TabsState {
  const task = entry(taskId)
  const view = sharedView(task)
  const index = next.tabs.findIndex((t) => t.id === next.activeId)
  const focusChanged = task.active?.id !== next.activeId
  task.active = { id: next.activeId, index: Math.max(0, index) }
  // Diff against what the reducer started from, not the newest view: a tab another client
  // added since is not one this TUI closed. No record yet → seed.
  const ops = diffTabs(view === null ? null : base ? toShared(base) : view, toShared(next))
  // A new row's ordinal came off the head of the reservation: it is spent.
  for (const op of ops) {
    if (op.op !== "open" || typeof op.row.ordinal !== "number") continue
    const used = op.row.ordinal
    task.reserved = task.reserved.filter((n) => n !== used)
  }
  if (focusChanged && next.tabs.some((t) => t.id === next.activeId)) ops.push({ op: "focus", id: next.activeId })
  if (ops.length > 0) send(taskId, ops)
  if (task.reserved.length <= 1) ensureTabReservation(taskId)
  return publish(taskId) ?? next
}

/** The state to render for `taskId` now, or null when the daemon has no tabs for it (or has not answered yet). */
export function taskTabsView(taskId: string): TabsState | null {
  const task = tasks.get(taskId)
  if (!task) return null
  const view = sharedView(task)
  return view ? uiState(task, view) : null
}

/**
 * Keep at least two ordinals reserved for `taskId` so this TUI mints new tabs
 * without a round trip. Called when a task's tabs mount and after each mint.
 */
export function ensureTabReservation(taskId: string): void {
  const task = entry(taskId)
  if (!transport || task.reserving || task.reserved.length > 1) return
  task.reserving = true
  transport
    .reserve(taskId, RESERVE_BLOCK)
    .then(({ from, to }) => {
      for (let n = from; n < to; n++) task.reserved.push(n)
      publish(taskId)
    })
    .catch((err) => logClientError("tabs", err))
    .finally(() => {
      task.reserving = false
    })
}

/** `count` fresh ordinals for `taskId` straight from the daemon (a fold naming several tabs at once); null when detached. */
export async function reserveTabOrdinals(taskId: string, count: number): Promise<number[] | null> {
  if (!transport) return null
  const { from, to } = await transport.reserve(taskId, count)
  return Array.from({ length: to - from }, (_, i) => from + i)
}

/** Give unused ordinals back when the task's tabs unmount, so numbering stays dense. */
export function releaseTabReservation(taskId: string): void {
  const task = tasks.get(taskId)
  const held = task?.reserved ?? []
  if (!task || held.length === 0 || !transport) return
  task.reserved = []
  // The daemon only takes back a tail it handed out last; anything else stays a gap.
  const from = Math.min(...held)
  const to = Math.max(...held) + 1
  if (to - from === held.length) void transport.release(taskId, from, to).catch((err) => logClientError("tabs", err))
}

/**
 * Open a tab for a task this TUI may not be showing (kanban issue start, the
 * scratch fold): the daemon mints the id. Resolves the new id, or null if the
 * daemon refused.
 */
export async function openTaskTab(
  taskId: string,
  row: Omit<TabRow, "id" | "ordinal">,
  after?: string | null,
): Promise<string | null> {
  if (!transport) return null
  const reply = await transport.apply(taskId, [{ op: "open", row, ...(after !== undefined ? { after } : {}) }])
  accept(taskId, reply.state, reply.rev)
  publish(taskId)
  return reply.opened[0] ?? null
}

/** Task deleted or its worktree gone: drop its tabs here and in the daemon. */
export function forgetTaskTabsView(taskId: string): void {
  tasks.delete(taskId)
  deleteTaskTabs(taskId)
  // A vanished worktree takes its tabs with it for every client, not just this one; on a
  // delete the daemon's own flow already did this, and a repeat is a no-op.
  void transport?.apply(taskId, [{ op: "forget" }]).catch((err) => logClientError("tabs", err))
}

/** Wire this TUI to a daemon (or detach with null). Loads every task's tabs and follows `tabs.changed`. */
export function attachTabsTransport(next: TabsTransport | null): () => void {
  transport = next
  loaded = false
  if (!next) return () => {}
  const off = next.onChanged((event) => {
    accept(event.taskId, event.state, event.rev)
    publish(event.taskId)
  })
  void reloadTabs()
  return () => {
    off()
    if (transport === next) transport = null
  }
}

/** (Re)load every task's tabs: on attach and after a reconnect, when `tabs.changed` events may have been missed. */
export async function reloadTabs(): Promise<void> {
  const current = transport
  if (!current) return
  try {
    const { tasks: all, rev } = await current.list()
    for (const [taskId, state] of Object.entries(all)) accept(taskId, state, rev)
    for (const [taskId, task] of tasks) if (!(taskId in all) && task.pending.length === 0) accept(taskId, null, rev)
    loaded = true
    for (const taskId of new Set([...tasks.keys(), ...Object.keys(all)])) publish(taskId)
  } catch (err) {
    logClientError("tabs", err)
  }
}

/** Test seam: drop all state. */
export function resetTabsSyncForTests(): void {
  transport = null
  loaded = false
  tasks.clear()
  tabsByTask.clear()
}

/** Once per host: attach this TUI to its daemon's tab store, and reload after every reconnect. */
export function useTabsSync(
  channel: TabsTransport | undefined,
  connection: { (): string; subscribe(listener: () => void): () => void } | undefined,
): void {
  useEffect(() => {
    // A host without a tab channel (an orchestrator double, an older client) leaves whatever
    // transport is attached alone: detaching here would cut every other writer off the daemon.
    if (!channel || !connection) return
    const detach = attachTabsTransport(channel)
    let last = connection()
    const off = connection.subscribe(() => {
      const now = connection()
      // `tabs.changed` sent while the socket was down never arrived.
      if (now === "online" && last !== "online") void reloadTabs()
      last = now
    })
    return () => {
      off()
      detach()
    }
  }, [channel, connection])
}
