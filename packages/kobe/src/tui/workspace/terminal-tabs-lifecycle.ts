/**
 * Every transition that mints a whole {@link TabsState} from something other
 * than a user action: first mount, restart snapshot, reviving an emptied task,
 * the last tab exiting. They must AGREE with each other (pinned engine
 * carried, `nextOrdinal` consumed), hence one file.
 *
 * Imports only types, so core can re-export these without an import cycle.
 */

import type { TabsState, TerminalTab } from "./terminal-tab-shapes"

/** A task's initial state: one untitled engine tab, active. */
export function initialTabs(): TabsState {
  return { tabs: [{ kind: "engine", id: "tab-1", title: null, ordinal: 1 }], activeId: "tab-1", nextOrdinal: 2 }
}

/**
 * What to reopen an emptied task as, from the tab that just closed. Only the
 * SHAPE is carried, never the session (the PTY died with the tab). A
 * content/preview tab reopens as an engine.
 */
export function reopenHintFor(closed: TerminalTab | undefined): TabsState["reopenAs"] {
  if (closed?.kind === "command") return { kind: "command" }
  if (closed?.kind === "engine" && closed.vendor) return { kind: "engine", vendor: closed.vendor }
  return { kind: "engine" }
}

/**
 * Revive a task whose last tab was closed: one fresh tab of the kind that was
 * there, active. `shell` is a `command` tab's respawn argv. An absent
 * `reopenAs` (older snapshot) means the default engine tab, never a refusal.
 */
export function reopenTabs(state: TabsState, shell: string): TabsState {
  const ordinal = state.nextOrdinal
  const id = `tab-${ordinal}`
  const next = state.nextOrdinal + 1
  if (state.reopenAs?.kind === "command") {
    return { tabs: [{ kind: "command", id, title: null, ordinal, command: [shell] }], activeId: id, nextOrdinal: next }
  }
  const vendor = state.reopenAs?.kind === "engine" ? state.reopenAs.vendor : undefined
  return {
    tabs: [{ kind: "engine", id, title: null, ordinal, ...(vendor ? { vendor } : {}) }],
    activeId: id,
    nextOrdinal: next,
  }
}

/** A SCRATCH task's initial state: one bare shell tab, active. */
export function initialShellTabs(shell: string): TabsState {
  return {
    tabs: [{ kind: "command", id: "tab-1", title: null, ordinal: 1, command: [shell] }],
    activeId: "tab-1",
    nextOrdinal: 2,
  }
}

/**
 * Rehydrate a persisted snapshot. EVERY tab survives restart: engine tabs
 * keep identity + sessionId for `--resume`; command tabs come back running
 * `shell` (not a fresh engine, which would reopen a shell as claude). An
 * empty/corrupt snapshot falls back to `initialTabs()`; a missing `activeId`
 * re-anchors.
 */
export function rehydrateTabs(
  persisted: TabsState,
  shell: readonly string[],
  /** Keep an intentionally-empty snapshot empty (else a closed task regrows a
   *  tab on mount). Off by default so a CORRUPT snapshot still recovers. */
  opts: { readonly allowEmpty?: boolean } = {},
): TabsState {
  const tabs = persisted.tabs.map(
    (t): TerminalTab => (t.kind === "command" ? { ...t, command: shell, purpose: undefined } : t),
  )
  if (tabs.length === 0) return opts.allowEmpty ? persisted : initialTabs()
  const activeId = tabs.some((t) => t.id === persisted.activeId) ? persisted.activeId : tabs[0].id
  const maxOrdinal = tabs.reduce((max, t) => Math.max(max, t.ordinal), 0)
  return { tabs, activeId, nextOrdinal: Math.max(persisted.nextOrdinal, maxOrdinal + 1) }
}

/**
 * Recycle-in-place for the last tab's exit: a fresh engine tab (new session)
 * that KEEPS `title`/`autoTitle`, so the strip doesn't rename itself (the
 * carried autoTitle also blocks the naming pass), and keeps the PINNED engine
 * (`vendor`/`engineCommand`), as {@link reopenHintFor} does.
 *
 * The id comes from `nextOrdinal`, never reset: `TabBase.id` is never reused
 * within a task, since inbox episodes and orphan-adoption suppression are
 * keyed `(taskId, tabId)`.
 */
export function recycleTabs(state: TabsState, prev: TerminalTab): TabsState {
  const ordinal = state.nextOrdinal
  const id = `tab-${ordinal}`
  const pinned = prev.kind === "engine" ? prev : undefined
  return {
    tabs: [
      {
        kind: "engine",
        id,
        ordinal,
        title: prev.title,
        autoTitle: prev.autoTitle,
        ...(pinned?.vendor ? { vendor: pinned.vendor } : {}),
        ...(pinned?.engineCommand ? { engineCommand: pinned.engineCommand } : {}),
      },
    ],
    activeId: id,
    nextOrdinal: ordinal + 1,
  }
}
