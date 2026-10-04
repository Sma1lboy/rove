/**
 * Tab state shared between the mounted `TerminalTabs` and host flows that run
 * while it may not be mounted. Module-level on purpose: it outlives any mount,
 * so snapshots survive task switches and F7 can request an activation before
 * the target task's tabs exist.
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

/** Per-task tab state for the process lifetime.
 *
 *  Write only through `setTaskTabs` / `deleteTaskTabs`: a raw Map mutation is
 *  invisible to React, and `ShowWorkspace` decides whether to mount
 *  `TerminalTabs` from this map, so closing the last tab would leave it
 *  mounted dereferencing a vanished `active` tab. */
export const tabsByTask = new Map<string, TabsState>()

/** Bumped on every `tabsByTask` write so React readers re-render; a counter, not a copy. */
export const tabsRevision = createStateCell(0, "tabs.revision")

export function setTaskTabs(taskId: string, state: TabsState): void {
  tabsByTask.set(taskId, state)
  tabsRevision.update((n) => n + 1)
}

/**
 * Revive a task whose last tab was closed (selecting the row reopens the kind
 * of tab that was there; no `reopenAs` → default engine tab, see
 * {@link reopenTabs}). No-op for a task with tabs, and for one that never
 * opened any (`null`, not empty: TerminalTabs mints its own on mount).
 */
export function reviveEmptiedTabs(kv: TabsSnapshotKv | null, taskId: string, shell: string): boolean {
  const known = knownTabsState(kv, taskId)
  if (!known || known.tabs.length > 0) return false
  setTaskTabs(taskId, reopenTabs(known, shell))
  return true
}

function deleteTaskTabs(taskId: string): void {
  if (!tabsByTask.delete(taskId)) return
  tabsRevision.update((n) => n + 1)
}

/** The attention jump's "where am I". Null when the task never mounted tabs. */
export function activeTabIdFor(taskId: string): string | null {
  return tabsByTask.get(taskId)?.activeId ?? null
}

/** Live state, else the restart snapshot, else null (never opened tabs).
 *  `kv` is nullable so a surface without a KV provider (render tests, early
 *  mounts) still sees live tabs; the map is authoritative for running tasks. */
export function knownTabsState(kv: TabsSnapshotKv | null, taskId: string): TabsState | null {
  const live = tabsByTask.get(taskId)
  if (live) return live
  const saved = kv?.store[terminalTabsKey(taskId)] as TabsState | null | undefined
  return saved && Array.isArray(saved.tabs) ? saved : null
}

export function knownTaskTab(kv: TabsSnapshotKv, taskId: string, tabId: string): TerminalTab | undefined {
  return knownTabsState(kv, taskId)?.tabs.find((tab) => tab.id === tabId)
}

/**
 * TRI-STATE tab existence, the ONE implementation every Inbox surface must
 * use: `true` present, `false` list readable and tab gone, `undefined` list
 * unreadable (this process never mounted that task's TerminalTabs). Callers
 * DELETE episodes that read as gone, so collapsing "don't know" into "gone"
 * destroys live episodes (hidden rows still counted by the badge, opening one
 * dismisses it).
 */
export function taskTabExists(kv: TabsSnapshotKv | null, taskId: string, tabId: string): boolean | undefined {
  const known = knownTaskTabs(kv, taskId)
  if (known === null) return undefined
  return known.tabs.some((tab) => tab.id === tabId)
}

/**
 * Tabs as a non-hosting surface (the sidebar tree) sees them. Null = never
 * opened tabs, not zero tabs: the tree renders no children rather than claim
 * an empty worktree, since mounting always yields at least one.
 */
export function knownTaskTabs(
  kv: TabsSnapshotKv | null,
  taskId: string,
): { tabs: readonly TerminalTab[]; activeId: string } | null {
  const state = knownTabsState(kv, taskId)
  return state ? { tabs: state.tabs, activeId: state.activeId } : null
}

/**
 * One cross-component request slot, claimed by whoever owns the named task's
 * tab state. All boxes share ONE listener set, so `use-tab-requests.ts` drains
 * every kind in a fixed order per pass. `take` only yields to the addressed
 * task; `takeUnclaimed` yields regardless and is exported only for the four
 * boxes whose callers have a background fallback (see {@link requestNewTab}).
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
const renameBox = requestBox<{ tabId: string; title: string }>()

/**
 * F7 activation: consumed by the mounted TerminalTabs, or on mount once the
 * host selects the task. Unknown tab ids are dropped (the tab may have closed).
 */
export const requestTabActivation = activationBox.request
export const takeTabActivation = activationBox.take

/** `tab.open` (plugin panes); consumed like activation. Positional args
 *  because every caller is a plugin bridge. */
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
 * Tree right-click "New conversation" / "New shell". Needs the task's OWN
 * workspace (dialog, or a PTY where the tabs render), so the caller selects
 * the task first and the request waits for mount; that's why this box, like
 * activation/open/pane-close, has no unclaimed reader.
 */
export const requestNewTab = newTabBox.request
export const takeNewTab = newTabBox.take

/** `tab.close`, inverse of {@link requestTabOpen}. Matches by pane label, so
 *  only titled split-leaves / command tabs (what tab.open creates) close. */
export function requestPaneClose(taskId: string, title: string, tabId?: string): void {
  paneCloseBox.request(taskId, { title, tabId })
}
export const takePaneClose = paneCloseBox.take

/**
 * The tree can name a tab of an UNMOUNTED task, so an unconsumed request means
 * nobody owns the state and the write happens in the background.
 * `closeTaskTab` (terminal-tabs-close.ts) decides by whether the request
 * survived the listener sweep. Adopt, move and rename share this protocol.
 */
export const requestTabClose = tabCloseBox.request
export const takeTabClose = tabCloseBox.take

/** Non-null = no mounted TerminalTabs claimed it. Clears the request either way. */
export function takeUnclaimedTabClose(): { taskId: string; tabId: string } | null {
  const claimed = tabCloseBox.takeUnclaimed()
  return claimed && { taskId: claimed.taskId, tabId: claimed.payload }
}

/** See `terminal-tabs-adopt.ts`. */
export const requestTabAdopt = adoptBox.request
export const takeTabAdopt = adoptBox.take

/** The twin of {@link takeUnclaimedTabClose} for adoption. */
export function takeUnclaimedTabAdopt(): { taskId: string; tabIds: readonly string[] } | null {
  const claimed = adoptBox.takeUnclaimed()
  return claimed && { taskId: claimed.taskId, tabIds: claimed.payload }
}

/** Sidebar move mode; background write is `moveTaskTabRow`. */
export function requestTabMove(taskId: string, tabId: string, delta: -1 | 1): void {
  moveBox.request(taskId, { tabId, delta })
}
export const takeTabMove = moveBox.take

/** The twin of {@link takeUnclaimedTabClose} for tab moves. */
export function takeUnclaimedTabMove(): { taskId: string; tabId: string; delta: -1 | 1 } | null {
  const claimed = moveBox.takeUnclaimed()
  return claimed && { taskId: claimed.taskId, ...claimed.payload }
}

/** `rove api rename --tab` via the daemon's `tab.rename` broadcast; background write is `renameTaskTab`. */
export function requestTabRename(taskId: string, tabId: string, title: string): void {
  renameBox.request(taskId, { tabId, title })
}
export const takeTabRename = renameBox.take

/** The twin of {@link takeUnclaimedTabClose} for tab renames. */
export function takeUnclaimedTabRename(): { taskId: string; tabId: string; title: string } | null {
  const claimed = renameBox.takeUnclaimed()
  return claimed && { taskId: claimed.taskId, ...claimed.payload }
}

/** Injected `reportUiEvent`; no-op until wired (mock hosts, tests, pure TUI before attach). */
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
 * tab.opened / tab.closed (+ file.closed for the editor singleton) off one
 * transition. Mount-time restores never pass through, so they don't re-announce.
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
 * DELETE flow only: drop the otherwise only-growing `tabsByTask` entry and the
 * kv snapshot. PTYs are released by the host's deleting-task sweep / tab exit.
 */
export function forgetTaskTabs(kv: TabsSnapshotKv, taskId: string): void {
  deleteTaskTabs(taskId)
  forgetTaskTabsSnapshot(kv, taskId)
}

/** Live entry, else persisted snapshot, else a fresh single tab. */
function currentTabsState(kv: TabsSnapshotKv, taskId: string, shell: string): TabsState {
  const inMemory = tabsByTask.get(taskId)
  if (inMemory) return inMemory
  const saved = kv.store[terminalTabsKey(taskId)] as TabsState | null | undefined
  return saved && Array.isArray(saved.tabs) ? rehydrateTabs(saved, [shell]) : initialTabs()
}

/**
 * Append an already-spawned engine tab to an UNMOUNTED task (kanban
 * issue-start). Writes the map AND kv so the next mount or restart attaches to
 * the live PTY; the caller spawns it under `tabPtyKeyFor(taskId, tab)`.
 */
export function appendBackgroundEngineTab(
  kv: TabsSnapshotKv,
  taskId: string,
  shell: string,
  spec: {
    vendor: VendorId
    /** Viewport tab: the referenced session's id, so a dead-reattach resumes it. Omit to pin a fresh one. */
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
  // A real open: otherwise the tab's `tab.closed` is the first a plugin hears
  // of it and open-pane counts underflow.
  reportTabsDelta(taskId, state.tabs, next.tabs)
  return { state: next, tab }
}
