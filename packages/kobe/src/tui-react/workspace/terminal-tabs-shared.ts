/**
 * Cross-component tab state shared between the mounted `TerminalTabs`
 * component and the host-side flows that need it while the component may
 * not be mounted. That is the seam, and why it CANNOT live in the component:
 * module-level, framework-agnostic process state outlives any mount, so
 * per-task tab snapshots survive task switches and the F7 attention jump can
 * request a tab activation before the target task's tabs ever exist.
 */

import { engineLaunchArgv, withPinnedSessionId } from "../../engine/engine-presets"

import { createStateCell } from "../../lib/external-store"
import {
  type EngineTab,
  type TabsState,
  type TerminalTab,
  initialTabs,
  rehydrateTabs,
  reopenTabs,
} from "../../tui/workspace/terminal-tabs-core"
import type { VendorId } from "../../types/vendor"
import { type TabsSnapshotKv, forgetTaskTabsSnapshot, terminalTabsKey } from "./terminal-tabs-persist"

/** Per-task tab state, preserved across task switches for the process.
 *
 *  WRITE THROUGH `setTaskTabs` / `deleteTaskTabs`, never `.set` / `.delete`
 *  directly: a plain Map mutation is invisible to React, and `ShowWorkspace`
 *  decides whether to mount `TerminalTabs` at all from this map. A raw
 *  mutation when a task's last tab closes re-renders nothing, leaving the
 *  component that owns the now-empty tab list mounted and dereferencing an
 *  `active` tab that is gone. */
export const tabsByTask = new Map<string, TabsState>()

/** Bumped on every `tabsByTask` write — the subscribable half of the map, so
 *  a React surface reading it re-renders when it changes. Cheap: a counter,
 *  not a copy of the state; readers still go to the map for the value. */
export const tabsRevision = createStateCell(0, "tabs.revision")

/** Write a task's tab state AND notify React readers. */
export function setTaskTabs(taskId: string, state: TabsState): void {
  tabsByTask.set(taskId, state)
  tabsRevision.update((n) => n + 1)
}

/**
 * Revive a task whose last tab was closed, returning true when it did.
 *
 * Selecting the task is the affordance: the sidebar row IS the button, so
 * entering an emptied task reopens the kind of tab that was there rather than
 * landing on a pane with nothing to press. A snapshot carrying no `reopenAs`
 * reopens the default engine tab — see {@link reopenTabs}.
 *
 * No-op for every other state: a task with tabs, and a task that has never
 * opened any (`null`, not empty — TerminalTabs mounts and mints its own).
 */
export function reviveEmptiedTabs(kv: TabsSnapshotKv | null, taskId: string, shell: string): boolean {
  const known = knownTabsState(kv, taskId)
  if (!known || known.tabs.length > 0) return false
  setTaskTabs(taskId, reopenTabs(known, shell))
  return true
}

/** Drop a task's tab state AND notify React readers. */
function deleteTaskTabs(taskId: string): void {
  if (!tabsByTask.delete(taskId)) return
  tabsRevision.update((n) => n + 1)
}

/** The task's currently-active tab id (module map read) — the attention
 *  jump's "where am I" input. Null when the task never mounted tabs. */
export function activeTabIdFor(taskId: string): string | null {
  return tabsByTask.get(taskId)?.activeId ?? null
}

/** The task's known tab state — live process state, else its restart
 *  snapshot, else null when this task has never opened tabs.
 *
 *  `kv` is nullable so a surface with no KV provider (render tests, a pane
 *  mounted before the context exists) still sees the live tabs instead of
 *  crashing: the in-memory map is authoritative for anything running now,
 *  and the snapshot only adds tasks that have not mounted since restart. */
function knownTabsState(kv: TabsSnapshotKv | null, taskId: string): TabsState | null {
  const live = tabsByTask.get(taskId)
  if (live) return live
  const saved = kv?.store[terminalTabsKey(taskId)] as TabsState | null | undefined
  return saved && Array.isArray(saved.tabs) ? saved : null
}

/** Resolve a tab from live process state or its restart snapshot. */
export function knownTaskTab(kv: TabsSnapshotKv, taskId: string, tabId: string): TerminalTab | undefined {
  return knownTabsState(kv, taskId)?.tabs.find((tab) => tab.id === tabId)
}

/**
 * TRI-STATE "does this tab exist" — the ONE implementation every Inbox
 * surface must use. `true` = present, `false` = the tab list was readable
 * and this tab is gone, `undefined` = the list could not be read at all
 * (this process never mounted that task's TerminalTabs, so it has no KV
 * snapshot).
 *
 * The distinction is load-bearing because callers DELETE episodes that read
 * as unavailable. `knownTaskTab(...) !== undefined` collapses "don't know"
 * into "gone" and destroys live episodes: the list hides episodes the badge
 * still counts, and opening such a row silently dismisses it instead of
 * navigating. The host, the dialog, its per-row badge and the F7 jump must
 * all route their availability question through here.
 */
export function taskTabExists(kv: TabsSnapshotKv | null, taskId: string, tabId: string): boolean | undefined {
  const known = knownTaskTabs(kv, taskId)
  if (known === null) return undefined
  return known.tabs.some((tab) => tab.id === tabId)
}

/**
 * A task's tabs as a surface that does NOT host them sees them — the sidebar
 * tree, which lists every worktree's tabs whether or not that worktree is the
 * selected one (only the selected task has a mounted TerminalTabs).
 *
 * Null means "this task has never opened tabs", which is NOT the same as an
 * empty list: the tree renders no children for the former rather than
 * claiming the worktree has zero tabs, since mounting always yields at least
 * one.
 */
export function knownTaskTabs(
  kv: TabsSnapshotKv | null,
  taskId: string,
): { tabs: readonly TerminalTab[]; activeId: string } | null {
  const state = knownTabsState(kv, taskId)
  return state ? { tabs: state.tabs, activeId: state.activeId } : null
}

/**
 * One cross-component request slot: a caller (the sidebar, a plugin, the F7
 * jump) names a task, and whoever owns that task's tab state claims it.
 *
 * Every box shares ONE listener set — a request of any kind wakes every
 * mounted consumer, which is what lets `use-tab-requests.ts` drain them all in
 * a fixed order on a single pass. `take` hands the payload only to the task it
 * was addressed to. `takeUnclaimed` returns it whoever it was for, and is
 * re-exported ONLY by the three boxes whose callers have a background
 * fallback; the other four must wait for a mount (see {@link requestNewTab}).
 */
export const tabActivationListeners = new Set<() => void>()

function requestBox<T>(): {
  request(taskId: string, payload: T): void
  take(taskId: string): T | null
  takeUnclaimed(): { taskId: string; payload: T } | null
} {
  let pending: { taskId: string; payload: T } | null = null
  return {
    request(taskId, payload) {
      pending = { taskId, payload }
      for (const listener of tabActivationListeners) listener()
    },
    take(taskId) {
      if (pending?.taskId !== taskId) return null
      const { payload } = pending
      pending = null
      return payload
    },
    takeUnclaimed() {
      const claimed = pending
      pending = null
      return claimed
    },
  }
}

const activationBox = requestBox<string>()
const openBox = requestBox<{
  argv: readonly string[]
  title: string
  tabId?: string
  placement?: "split" | "tab"
  direction?: "right" | "down"
}>()
const newTabBox = requestBox<"chat" | "shell">()
const paneCloseBox = requestBox<{ title: string; tabId?: string }>()
const tabCloseBox = requestBox<string>()
const adoptBox = requestBox<readonly string[]>()
const moveBox = requestBox<{ tabId: string; delta: -1 | 1 }>()

/**
 * "Activate this tab" (the F7 attention jump). The mounted TerminalTabs for
 * `taskId` consumes it via the listener; a task that isn't mounted yet
 * consumes it on mount (the host selects the task first, TerminalTabs mounts,
 * then reads the pending request). Unknown tab ids are dropped on consume —
 * the tab may have closed meanwhile.
 */
export const requestTabActivation = activationBox.request
export const takeTabActivation = activationBox.take

/** "Open a command tab" (`tab.open` — plugin panes). Activation's twin:
 *  consumed by the mounted TerminalTabs, or on mount for a task selected
 *  later. Positional args rather than the box's payload object because every
 *  caller is a plugin bridge passing them one at a time. */
export function requestTabOpen(
  taskId: string,
  argv: readonly string[],
  title: string,
  placement?: "split" | "tab",
  direction?: "right" | "down",
  tabId?: string,
): void {
  openBox.request(taskId, { argv, title, placement, direction, tabId })
}
export const takeTabOpen = openBox.take

/**
 * "Add a session to this task" — the sidebar tree's right-click
 * "New conversation" / "New shell".
 *
 * Twin of {@link requestTabActivation}, not of {@link requestTabClose}: both
 * kinds need the task's OWN workspace (the picker is a dialog; a shell tab has
 * to spawn its PTY where the tabs render), so the caller selects the task
 * first and an unclaimed request simply waits for that mount instead of
 * falling back to a background write. That is why this box — and activation,
 * open and pane-close — exposes no unclaimed reader.
 */
export const requestNewTab = newTabBox.request
export const takeNewTab = newTabBox.take

/** "Close panes opened under a title" (`tab.close` — the inverse of
 *  {@link requestTabOpen}). Consumed by the mounted TerminalTabs; matching is
 *  by pane label, so only titled split-leaves / command tabs (the ones
 *  tab.open creates) are affected. */
export function requestPaneClose(taskId: string, title: string, tabId?: string): void {
  paneCloseBox.request(taskId, { title, tabId })
}
export const takePaneClose = paneCloseBox.take

/**
 * "Close this tab". Unlike its twins above, this one has a caller that can
 * name a tab of a task whose TerminalTabs is NOT mounted (the sidebar tree
 * lists every worktree's tabs), so an unconsumed request is not "wait for
 * mount" — it means nobody owns that task's state right now and the write has
 * to happen in the background. `closeTaskTab` (terminal-tabs-close.ts) is what
 * decides between the two by checking whether the request survived the
 * listener sweep. Adopt and move below share that protocol.
 */
export const requestTabClose = tabCloseBox.request
export const takeTabClose = tabCloseBox.take

/** Whether the last {@link requestTabClose} went unclaimed — i.e. no mounted
 *  TerminalTabs owns that task. Clears the request either way. */
export function takeUnclaimedTabClose(): { taskId: string; tabId: string } | null {
  const claimed = tabCloseBox.takeUnclaimed()
  return claimed && { taskId: claimed.taskId, tabId: claimed.payload }
}

/** "Adopt these live tab ids" — see `terminal-tabs-adopt.ts` for what
 *  adoption is for. */
export const requestTabAdopt = adoptBox.request
export const takeTabAdopt = adoptBox.take

/** The twin of {@link takeUnclaimedTabClose} for adoption. */
export function takeUnclaimedTabAdopt(): { taskId: string; tabIds: readonly string[] } | null {
  const claimed = adoptBox.takeUnclaimed()
  return claimed && { taskId: claimed.taskId, tabIds: claimed.payload }
}

/** "Move this tab up/down" (sidebar move mode); the background write is
 *  `moveTaskTabRow`. */
export function requestTabMove(taskId: string, tabId: string, delta: -1 | 1): void {
  moveBox.request(taskId, { tabId, delta })
}
export const takeTabMove = moveBox.take

/** The twin of {@link takeUnclaimedTabClose} for tab moves. */
export function takeUnclaimedTabMove(): { taskId: string; tabId: string; delta: -1 | 1 } | null {
  const claimed = moveBox.takeUnclaimed()
  return claimed && { taskId: claimed.taskId, ...claimed.payload }
}

/**
 * UI-event bridge for plugin events: the host injects the orchestrator's
 * `reportUiEvent` once; tab open/close edges (and editor-file closes)
 * report through it. No-op until wired (mock hosts, tests, pure TUI
 * before attach).
 */
type UiEventReporter = (kind: string, taskId?: string, detail?: Record<string, unknown>) => void
let uiEventReporter: UiEventReporter | null = null

export function setUiEventReporter(fn: UiEventReporter | null): void {
  uiEventReporter = fn
}

function tabDetail(tab: TerminalTab): Record<string, unknown> {
  return {
    tabId: tab.id,
    kind: tab.kind,
    ...(tab.title ? { title: tab.title } : {}),
    ...(tab.kind === "engine" && tab.vendor ? { vendor: tab.vendor } : {}),
    ...(tab.kind === "command" && tab.purpose ? { purpose: tab.purpose } : {}),
  }
}

/**
 * Report tab.opened / tab.closed (+ file.closed when the closing tab is the
 * editor singleton) off one state transition. Called from the mounted
 * TerminalTabs' single state writer; mount-time restores never pass through
 * it, so restored tabs don't re-announce as opened.
 */
export function reportTabsDelta(taskId: string, prev: readonly TerminalTab[], next: readonly TerminalTab[]): void {
  if (!uiEventReporter || prev === next) return
  const report = uiEventReporter
  const prevIds = new Set(prev.map((tab) => tab.id))
  const nextIds = new Set(next.map((tab) => tab.id))
  for (const tab of next) if (!prevIds.has(tab.id)) report("tab.opened", taskId, tabDetail(tab))
  for (const tab of prev) {
    if (nextIds.has(tab.id)) continue
    report("tab.closed", taskId, tabDetail(tab))
    if (tab.kind === "command" && tab.purpose === "editor") {
      // The editor tab's argv ends with the absolute file path (host-built).
      const path = [...tab.command].reverse().find((arg) => arg.startsWith("/"))
      report("file.closed", taskId, { ...(path ? { path } : {}), ...(tab.title ? { title: tab.title } : {}) })
    }
  }
}

/**
 * Reclaim a DELETED task's in-process + persisted tab state: drop its
 * `tabsByTask` entry (module-level, otherwise only-grows) and its
 * `terminalTabs.*` kv snapshot. Call from the task-DELETE flow only. Its PTYs
 * are released separately by the host's deleting-task sweep / the tab's own
 * exit path.
 */
export function forgetTaskTabs(kv: TabsSnapshotKv, taskId: string): void {
  deleteTaskTabs(taskId)
  forgetTaskTabsSnapshot(kv, taskId)
}

/** The task's current tab state as a NON-mounted flow sees it: the live
 *  module entry, else the persisted snapshot, else a fresh single tab. */
function currentTabsState(kv: TabsSnapshotKv, taskId: string, shell: string): TabsState {
  const inMemory = tabsByTask.get(taskId)
  if (inMemory) return inMemory
  const saved = kv.store[terminalTabsKey(taskId)] as TabsState | null | undefined
  return saved && Array.isArray(saved.tabs) ? rehydrateTabs(saved, [shell]) : initialTabs()
}

/**
 * Append an already-spawned engine tab to a task whose TerminalTabs is NOT
 * mounted — the kanban issue-start paths ("new chattab in the project
 * workspace", jump or stay). Writes the module map AND the kv snapshot so
 * the next mount (or restart) renders the tab and attaches to its live PTY.
 * Returns the created tab; the caller spawns its PTY under
 * `tabPtyKeyFor(taskId, tab)` before or right after this write.
 */
export function appendBackgroundEngineTab(
  kv: TabsSnapshotKv,
  taskId: string,
  shell: string,
  spec: {
    vendor: VendorId
    /** Pass the referenced session's id for a viewport tab (`ptyTask`) so a
     *  dead-reattach resumes THAT conversation; omit to pin a fresh one. */
    sessionId?: string | null
    ptyTask?: EngineTab["ptyTask"]
  },
): { state: TabsState; tab: EngineTab } {
  const state = currentTabsState(kv, taskId, shell)
  const ordinal = state.nextOrdinal
  const sessionId =
    spec.sessionId !== undefined
      ? spec.sessionId
      : withPinnedSessionId(engineLaunchArgv({ vendor: spec.vendor }), spec.vendor).sessionId
  const tab: EngineTab = {
    kind: "engine",
    id: `tab-${ordinal}`,
    title: null,
    ordinal,
    vendor: spec.vendor,
    sessionId,
    spawned: true,
    ...(spec.ptyTask ? { ptyTask: spec.ptyTask } : {}),
  }
  const next: TabsState = {
    tabs: [...state.tabs, tab],
    activeId: tab.id,
    nextOrdinal: ordinal + 1,
  }
  setTaskTabs(taskId, next)
  kv.set(terminalTabsKey(taskId), next)
  return { state: next, tab }
}
