/**
 * Pure tab-list transitions for the workspace terminal tabs. User contract:
 * a new tab spawns the SAME engine command in the same worktree, the last tab
 * can't be closed, titles are renameable, bracket chords cycle. Tab PTYs are
 * PtyRegistry entries keyed `${taskId}::${tabId}` that survive task switches
 * until closed.
 */

import type { VendorId } from "@/types/vendor"
import type { PersistedSplit } from "./terminal-tab-split"

// Re-exports keep one entry point for importers.
export {
  type PersistedSplit,
  collapseSplit,
  hasEngineLeaf,
  isTabSplit,
  splitLeafNames,
  splitLeafPtyKey,
  tabTitle,
  tabTitleStable,
  visibleNativeStatus,
} from "./terminal-tab-split"

export type { CommandTab, ContentTab, EngineTab, TabsState, TerminalTab } from "./terminal-tab-shapes"
import type { CommandTab, ContentTab, TabsState, TerminalTab } from "./terminal-tab-shapes"

export { initialShellTabs, initialTabs, recycleTabs, rehydrateTabs, reopenTabs } from "./terminal-tabs-lifecycle"
import { reopenHintFor } from "./terminal-tabs-lifecycle"

/** Shared insert: append `tab` after the active tab and focus it. */
function insertAfterActive(state: TabsState, tab: TerminalTab): TabsState {
  const i = state.tabs.findIndex((t) => t.id === state.activeId)
  const tabs = [...state.tabs.slice(0, i + 1), tab, ...state.tabs.slice(i + 1)]
  return { tabs, activeId: tab.id, nextOrdinal: state.nextOrdinal + 1 }
}

/**
 * Open a new tab after the active one and focus it. `vendor` pins that tab
 * to a specific engine (the `chat.tab.chooseEngine` flow); omitted, it
 * inherits the task's current engine like every plain `ctrl+t` tab.
 */
export function addTab(state: TabsState, vendor?: VendorId): TabsState {
  const ordinal = state.nextOrdinal
  return insertAfterActive(state, { kind: "engine", id: `tab-${ordinal}`, title: null, ordinal, vendor })
}

/**
 * Open a one-off command tab after the active tab and focus it. Runs the
 * resolved `command` (e.g. `["sh", "-c", "nvim -d ..."]`); `label` null lets
 * the live foreground-process title name the tab. Closes itself when the
 * process exits (`TerminalTabs.tsx`'s `onExit`).
 */
export function openCommandTab(state: TabsState, command: readonly string[], label: string | null): TabsState {
  const ordinal = state.nextOrdinal
  return insertAfterActive(state, { kind: "command", id: `tab-${ordinal}`, title: label, ordinal, command })
}

/** The FileTree-owned command tab, if this task already has one. */
export function findEditorTab(state: TabsState): CommandTab | undefined {
  return state.tabs.find((tab): tab is CommandTab => tab.kind === "command" && tab.purpose === "editor")
}

/**
 * Open or replace the one FileTree-owned editor tab. Its stable identity and
 * position make it a reusable File slot; callers restart its PTY when this
 * transition targets an existing tab.
 */
export function openEditorTab(state: TabsState, command: readonly string[], label: string): TabsState {
  const existing = findEditorTab(state)
  if (!existing) {
    const ordinal = state.nextOrdinal
    return insertAfterActive(state, {
      kind: "command",
      id: `tab-${ordinal}`,
      title: label,
      ordinal,
      command,
      purpose: "editor",
    })
  }
  const tabs = state.tabs.map(
    (tab): TerminalTab => (tab.id === existing.id ? { ...existing, title: label, command, splitTree: null } : tab),
  )
  return { ...state, tabs, activeId: existing.id }
}

/** The FileTree-owned read-only preview tab, if this task already has one. */
export function findContentTab(state: TabsState): ContentTab | undefined {
  return state.tabs.find((tab): tab is ContentTab => tab.kind === "content")
}

/**
 * Open or replace the one FileTree-owned read-only preview tab ({@link
 * ContentTab}), the `d` action's singleton slot like {@link openEditorTab}:
 * insert after the active tab the first time, then retarget it in place and
 * select it. Selecting is a content swap, not a focus grab: the FileTree
 * keeps keyboard focus.
 */
export function openContentTab(state: TabsState, relPath: string, label: string, base?: string): TabsState {
  const existing = findContentTab(state)
  if (!existing) {
    const ordinal = state.nextOrdinal
    return insertAfterActive(state, { kind: "content", id: `tab-${ordinal}`, title: label, ordinal, relPath, base })
  }
  const tabs = state.tabs.map(
    (tab): TerminalTab => (tab.id === existing.id ? { ...existing, title: label, relPath, base } : tab),
  )
  return { ...state, tabs, activeId: existing.id }
}

/**
 * Close a tab by id, focusing its left neighbor if it was active (right
 * neighbor when closing the first), so an ephemeral editor tab can close
 * itself on exit even after the user switched away. Refuses the only tab;
 * no-op (`closedId: null`) if `id` isn't present.
 */
export function closeTab(
  state: TabsState,
  id: string,
  /** Allow the LAST tab to close, leaving `tabs` empty. Off by default:
   *  `closeActive`'s scratch branch reads a refusal as "task ending", so
   *  always-on would turn every scratch ctrl+w into a teardown. */
  opts: { readonly allowEmpty?: boolean } = {},
): { state: TabsState; closedId: string | null } {
  if (state.tabs.length <= 1 && !opts.allowEmpty) return { state, closedId: null }
  const i = state.tabs.findIndex((t) => t.id === id)
  if (i < 0) return { state, closedId: null }
  const tabs = state.tabs.filter((t) => t.id !== id)
  if (state.activeId !== id) return { state: { ...state, tabs }, closedId: id }
  // Emptied: keep the closed id so nothing downstream special-cases "". A
  // tab-less task isn't mounted until `reopenTabs` revives it.
  if (tabs.length === 0) {
    return { state: { ...state, tabs, activeId: id, reopenAs: reopenHintFor(state.tabs[i]) }, closedId: id }
  }
  const next = tabs[Math.max(0, i - 1)]
  return { state: { ...state, tabs, activeId: (next ?? tabs[0]).id }, closedId: id }
}

/** Close the active tab (see {@link closeTab}); the caller surfaces a refusal. */
export function closeActiveTab(state: TabsState): { state: TabsState; closedId: string | null } {
  return closeTab(state, state.activeId)
}

/** Rename the active tab; empty/whitespace titles clear back to default. */
export function renameActiveTab(state: TabsState, title: string): TabsState {
  return setTabTitle(state, state.activeId, title)
}

/**
 * Rename one tab by id (`rove api rename --tab` has no "active" tab);
 * empty/whitespace clears to the default. Returns the SAME object when
 * unchanged, so the CLI write + TUI broadcast of one rename costs no
 * re-render or second persist.
 */
export function setTabTitle(state: TabsState, id: string, title: string): TabsState {
  const trimmed = title.trim()
  const next = trimmed.length > 0 ? trimmed : null
  const current = state.tabs.find((t) => t.id === id)
  if (!current || (current.title ?? null) === next) return state
  const tabs = state.tabs.map((t): TerminalTab => (t.id === id ? { ...t, title: next } : t))
  return { ...state, tabs }
}

/**
 * Record the engine session id pinned at PTY spawn. Separate from `addTab`
 * because the id is IO-generated (`randomUUID`), keeping this module pure.
 */
export function setTabSessionId(state: TabsState, id: string, sessionId: string | null): TabsState {
  const tabs = state.tabs.map((t): TerminalTab => (t.id === id && t.kind === "engine" ? { ...t, sessionId } : t))
  return { ...state, tabs }
}

/** Mark an engine tab as forked from `sourceSessionId` (see
 *  `EngineTab.forkFrom`). Same shape as {@link setTabSessionId}: the id
 *  comes from IO (the source tab's pin, or the engine's transcript store). */
export function setTabForkFrom(state: TabsState, id: string, sourceSessionId: string): TabsState {
  const tabs = state.tabs.map(
    (t): TerminalTab => (t.id === id && t.kind === "engine" ? { ...t, forkFrom: sourceSessionId } : t),
  )
  return { ...state, tabs }
}

/**
 * Pin the RAW launch command on an engine tab (see `EngineTab.engineCommand`),
 * so the tab launches `command` while its `vendor` carries the protocol kobe
 * resolved for it. Set together with a vendor when the two differ — a custom
 * preset (`claudecpa`) launches by its own name but speaks the wrapped
 * engine's session verbs.
 */
export function setTabEngineCommand(state: TabsState, id: string, command: string): TabsState {
  const tabs = state.tabs.map(
    (t): TerminalTab => (t.id === id && t.kind === "engine" ? { ...t, engineCommand: command } : t),
  )
  return { ...state, tabs }
}

/** Give an engine tab its own first-spawn prompt (see
 *  `EngineTab.initialPrompt`) — the cross-engine handoff brief. */
export function setTabInitialPrompt(state: TabsState, id: string, prompt: string): TabsState {
  const tabs = state.tabs.map(
    (t): TerminalTab => (t.id === id && t.kind === "engine" ? { ...t, initialPrompt: prompt } : t),
  )
  return { ...state, tabs }
}

/**
 * Record the tab's latest live process title. No-op when unchanged (the OSC
 * stream repeats it every turn) and when EMPTY: "no title reported" must never
 * erase the earlier one, or the tab would persist as its vendor default.
 */
export function setTabLastTitle(state: TabsState, id: string, lastTitle: string): TabsState {
  if (lastTitle.length === 0) return state
  const current = state.tabs.find((t) => t.id === id)
  if (!current || current.lastTitle === lastTitle) return state
  const tabs = state.tabs.map((t): TerminalTab => (t.id === id ? { ...t, lastTitle } : t))
  return { ...state, tabs }
}

/** Record the live engine identity (`TerminalTab.liveVendor`); no-op when unchanged (the probe repeats every tick). */
export function setTabLiveVendor(state: TabsState, id: string, liveVendor: VendorId | null): TabsState {
  const current = state.tabs.find((t) => t.id === id)
  if (!current || (current.liveVendor ?? null) === liveVendor) return state
  const tabs = state.tabs.map((t): TerminalTab => (t.id === id ? { ...t, liveVendor } : t))
  return { ...state, tabs }
}

/**
 * Record an auto-derived title. Callers only derive for tabs with neither a
 * user title nor an autoTitle; display precedence keeps a later F2 rename on top.
 */
export function setTabAutoTitle(state: TabsState, id: string, autoTitle: string): TabsState {
  const tabs = state.tabs.map((t): TerminalTab => (t.id === id ? { ...t, autoTitle } : t))
  return { ...state, tabs }
}

/**
 * Set an engine tab's spawned flag (`EngineTab.spawned`); identity-stable
 * when unchanged. `false` exists because `--session-id` creates NO transcript
 * until the first message: a tab that never conversed must not `--resume`
 * (claude errors "no conversation found").
 */
export function setTabSpawned(state: TabsState, id: string, spawned: boolean): TabsState {
  const tabs = state.tabs.map(
    (t): TerminalTab => (t.id === id && t.kind === "engine" && !t.spawned !== !spawned ? { ...t, spawned } : t),
  )
  return { ...state, tabs }
}

/** Mark an engine tab's PTY as having spawned (see `EngineTab.spawned`). */
export function markTabSpawned(state: TabsState, id: string): TabsState {
  return setTabSpawned(state, id, true)
}

export { engineTabArgv, engineTabSpawnFor, tabExitAction } from "./terminal-tab-argv"
export { type TabSpawn, shellCommandLine, shellIdentityInput, shellSpawn } from "./terminal-tab-spawn"

/** Cycle the active tab by ±1, wrapping at the ends. */
export function cycleTab(state: TabsState, delta: 1 | -1): TabsState {
  const n = state.tabs.length
  if (n <= 1) return state
  const i = state.tabs.findIndex((t) => t.id === state.activeId)
  const next = state.tabs[(i + delta + n) % n]
  return { ...state, activeId: next.id }
}

/**
 * Move a tab up/down (sidebar move mode). Edge-stops return the SAME state
 * (no wrap), so callers persist nothing. Order IS the persisted `tabs` array
 * order.
 */
export function moveTab(state: TabsState, id: string, delta: -1 | 1): TabsState {
  const i = state.tabs.findIndex((t) => t.id === id)
  const j = i + delta
  if (i < 0 || j < 0 || j >= state.tabs.length) return state
  const tabs = [...state.tabs]
  const a = tabs[i] as TerminalTab
  tabs[i] = tabs[j] as TerminalTab
  tabs[j] = a
  return { ...state, tabs }
}

/** Switch to `id` (tab-strip click). Returns the SAME state if absent or
 *  already active; a new object would trigger a state.json write and re-render. */
export function selectTab(state: TabsState, id: string): TabsState {
  if (state.activeId === id || !state.tabs.some((t) => t.id === id)) return state
  return { ...state, activeId: id }
}

/**
 * Set (or clear with `null`) a tab's frozen split layout; goes through the
 * component's `update` (state.json), so split changes survive restart.
 * Unknown ids no-op.
 */
export function setTabSplit(state: TabsState, id: string, tree: PersistedSplit | null): TabsState {
  if (!state.tabs.some((t) => t.id === id)) return state
  const tabs = state.tabs.map((t): TerminalTab => (t.id === id ? { ...t, splitTree: tree } : t))
  return { ...state, tabs }
}

/** Registry key for one tab's PTY — namespaced so tabs never collide. */
export function tabPtyKey(taskId: string, tabId: string): string {
  return `${taskId}::${tabId}`
}

/** A tab's actual PTY key: a viewport tab (see {@link EngineTab.ptyTask})
 *  attaches to the referenced task's FIRST engine session; every other tab
 *  keys under its own task. */
export function tabPtyKeyFor(taskId: string, tab: TerminalTab): string {
  if (tab.kind === "engine" && tab.ptyTask) return tabPtyKey(tab.ptyTask.id, "tab-1")
  return tabPtyKey(taskId, tab.id)
}

/** A tab's PTY working directory: viewport tabs run in the referenced
 *  task's worktree, everything else in the host task's. */
export function tabCwdFor(tab: TerminalTab, taskWorktree: string): string {
  if (tab.kind === "engine" && tab.ptyTask) return tab.ptyTask.worktree
  return taskWorktree
}
