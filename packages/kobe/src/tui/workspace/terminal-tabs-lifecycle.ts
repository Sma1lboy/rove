/**
 * How a task's tab list BEGINS, comes BACK, and starts OVER — every
 * transition that mints a whole {@link TabsState} from something other than a
 * user action: first mount, a restart snapshot, re-entering an emptied task,
 * and the last tab exiting.
 *
 * That is the seam. `terminal-tabs-core.ts` answers "what does this user
 * action do to the list that exists"; these four answer "where does a list
 * come from when there is none, or none that can be used". They are separated
 * because they must AGREE with each other, and silently did not: reopen
 * carried the closed tab's pinned engine and consumed `nextOrdinal` while
 * recycle dropped the engine and rewound to `tab-1`. Keeping them in one file
 * makes the next divergence visible.
 *
 * Depends only on `./terminal-tab-shapes` (types), so core can re-export these
 * for a single import entry point without an import cycle.
 */

import type { TabsState, TerminalTab } from "./terminal-tab-shapes"

/** A task's initial state: one untitled engine tab, active. */
export function initialTabs(): TabsState {
  return { tabs: [{ kind: "engine", id: "tab-1", title: null, ordinal: 1 }], activeId: "tab-1", nextOrdinal: 2 }
}

/**
 * What to reopen an emptied task as, derived from the tab that just closed.
 *
 * Only the SHAPE is carried, never the session: the PTY died with the tab, so
 * an engine comes back as a fresh engine (its `sessionId` deliberately absent)
 * and a shell as a fresh shell. A content/preview tab has no session to speak
 * of and reopens as an engine — reviving a file preview as the whole workspace
 * would be a strange thing to land in.
 */
export function reopenHintFor(closed: TerminalTab | undefined): TabsState["reopenAs"] {
  if (closed?.kind === "command") return { kind: "command" }
  if (closed?.kind === "engine" && closed.vendor) return { kind: "engine", vendor: closed.vendor }
  return { kind: "engine" }
}

/**
 * Revive a task whose last tab was closed: one fresh tab of the kind that was
 * there before, active. `shell` is the argv a `command` tab respawns with.
 *
 * `reopenAs` is absent for a snapshot written before it existed (an install
 * upgrading in place), and absence means the default engine tab — the same
 * thing {@link initialTabs} gives a brand-new task. That is the fallback, not
 * an error path: a user who upgrades mid-session should not be able to reach a
 * task that refuses to reopen.
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

/** A SCRATCH task's initial state: one bare shell tab, active —
 *  the task is the shell, an engine only appears when the user types one.
 *  Same shape the ctrl+e "shell" pick mints ({@link openCommandTab}). */
export function initialShellTabs(shell: string): TabsState {
  return {
    tabs: [{ kind: "command", id: "tab-1", title: null, ordinal: 1, command: [shell] }],
    activeId: "tab-1",
    nextOrdinal: 2,
  }
}

/**
 * Rehydrate a persisted tab snapshot. A tab is a TERMINAL: claude/an editor
 * are just processes that ran in it, so EVERY tab survives restart. Engine
 * tabs keep their identity
 * + sessionId so the host can `--resume` the conversation; command tabs
 * (a shell pick, a dead editor) come back running `shell` — their
 * process is gone, and spawning a fresh engine
 * in its place would reopen a closed shell as claude. Same
 * freeze-the-layout rule splitTree restore follows. Guards against a
 * corrupt/empty snapshot by falling back to `initialTabs()`; re-anchors
 * `activeId` if it pointed at a tab that is absent.
 */
export function rehydrateTabs(
  persisted: TabsState,
  shell: readonly string[],
  /** Keep an intentionally-empty snapshot empty.
   *  Without this a task whose last tab you closed grows one back on the next
   *  mount, so the close never appears to take. Off by default so a CORRUPT
   *  snapshot still recovers. */
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
 * Recycle-in-place state for the last tab's exit: a fresh engine tab (new
 * session) that KEEPS the exited tab's name — user `title` and `autoTitle`
 * carry over, so the strip doesn't visibly rename itself on every recycle.
 * The carried autoTitle also blocks the naming pass from deriving a new one
 * (its `!title && !autoTitle` self-limit), which was the "title changes
 * every recycle" bug.
 *
 * The tab's PINNED engine carries over too (`vendor`/`engineCommand`), the
 * same way {@link reopenHintFor} carries it for the revive path: a tab the
 * user pointed at Codex must not come back as the task's engine while still
 * wearing the Codex conversation's title.
 *
 * The id is minted from `state.nextOrdinal` rather than reset to `tab-1`,
 * because `TabBase.id` is never reused within a task: inbox episodes and the
 * orphan-adoption suppression in `terminal-tabs-close.ts` are both keyed
 * `(taskId, tabId)`, so a recycled `tab-1` would inherit a dead tab's
 * episodes and its in-flight suppression.
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
