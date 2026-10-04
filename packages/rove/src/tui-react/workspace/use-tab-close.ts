/**
 * Every way a tab goes away, in one per-render hook so the subtly different
 * exits can't drift (freshness from the per-render rebuild, plus refs for
 * mount-only callers):
 *
 *   - `closeActive`: ctrl+w. The last tab closes too and the row re-opens on
 *     ⏎ / ctrl+e; on a scratch task it tears the task down (its whole life IS
 *     that shell).
 *   - `closeById`: a close named from OUTSIDE (tree menu); ctrl+w minus the toast.
 *   - `closeExited`: the process ended; no viewport carve-out needed.
 *   - `handleActiveExit`: policy above `closeExited`: resume, close, or recycle in place.
 */

import { getDefaultPtyRegistry } from "../../tui/panes/terminal/registry"
import { noteClosedPtyKey } from "../../tui/workspace/closed-tab-suppress"
import {
  type TabsState,
  type TerminalTab,
  closeActiveTab,
  closeTab,
  recycleTabs,
  tabExitAction,
  tabPtyKey,
  tabPtyKeyFor,
} from "../../tui/workspace/terminal-tabs-core"
import type { VendorId } from "../../types/vendor"
import { releaseSplitLeaves } from "./TerminalSplit"
import { releaseClosedTabPtys } from "./terminal-tabs-close"

export interface TabCloseDeps {
  readonly stateRef: { readonly current: TabsState }
  readonly propsRef: { readonly current: { readonly taskId: string } }
  readonly updateRef: { readonly current: (next: TabsState) => void }
  /** Render-scope, so the hook is rebuilt with it. */
  readonly active: TerminalTab
  /** Recycle path: mint a fresh engine-session id on the active engine tab. */
  readonly pinSession: (state: TabsState, vendor: VendorId | undefined) => TabsState
  /** Nudge Terminal to re-acquire under the visible tab's key. */
  readonly bumpResetToken: () => void
  /** One-shot-per-tab dead-on-attach resume marks; component-owned to survive rebuilds. */
  readonly resumeTriedRef: { readonly current: Set<string> }
  /** Only reachable on a scratch task missing its teardown hook. */
  readonly notifyCannotCloseLast: (tabId: string) => void
  /** Scratch only: the LAST tab going away (exit or ctrl+w) ends the task. */
  readonly onScratchExit?: () => void
}

export interface TabClose {
  readonly closeActive: () => void
  readonly closeById: (id: string) => void
  readonly closeExited: (id: string) => void
  readonly handleActiveExit: (info?: { deadOnAttach?: boolean }) => void
}

export function useTabClose(deps: TabCloseDeps): TabClose {
  const taskId = (): string => deps.propsRef.current.taskId

  /** Reads FRESH state: exit events can come from a stale render. */
  function closeExited(id: string): void {
    const current = deps.stateRef.current
    const closing = current.tabs.find((tab) => tab.id === id)
    const { state: next, closedId } = closeTab(current, id)
    if (closedId) {
      const key = closing ? tabPtyKeyFor(taskId(), closing) : tabPtyKey(taskId(), closedId)
      releaseSplitLeaves(key, closing?.splitTree ?? null)
      getDefaultPtyRegistry().release(key)
      // Keep the orphan backstop from re-adopting the dying session before
      // its next poll sees the exit (closed-tab-suppress.ts).
      noteClosedPtyKey(key)
    }
    deps.updateRef.current(next)
  }

  function closeById(id: string): void {
    const current = deps.stateRef.current
    const closing = current.tabs.find((tab) => tab.id === id)
    // Scratch tasks refuse the last tab here; `closeActive` routes that via `onScratchExit`.
    const { state: next, closedId } = closeTab(current, id, { allowEmpty: deps.onScratchExit === undefined })
    // Refused: no such `id`, or a scratch task's last tab.
    if (!closedId) return
    deps.updateRef.current(next)
    releaseClosedTabPtys(taskId(), closing, closedId)
  }

  function closeActive(): void {
    const current = deps.stateRef.current
    const closing = current.tabs.find((tab) => tab.id === current.activeId)
    // Scratch: `closeActiveTab` refuses the last tab, and the refusal tears
    // the task down below.
    const { state: next, closedId } =
      deps.onScratchExit === undefined
        ? closeTab(current, current.activeId, { allowEmpty: true })
        : closeActiveTab(current)
    if (!closedId) {
      // Same path as the scratch shell exiting on its own.
      if (deps.onScratchExit) {
        if (closing) releaseClosedTabPtys(taskId(), closing, closing.id)
        deps.onScratchExit()
        return
      }
      deps.notifyCannotCloseLast(current.activeId)
      return
    }
    deps.updateRef.current(next)
    releaseClosedTabPtys(taskId(), closing, closedId)
  }

  function handleActiveExit(info?: { deadOnAttach?: boolean }): void {
    const active = deps.active
    // Possibly the echo of an intentional ctrl+w (the killed PTY's onExit hits
    // a STALE render). Acting on it would resurrect the closed tab
    // ("ctrl+w needs two presses").
    if (!deps.stateRef.current.tabs.some((tab) => tab.id === active.id)) return
    // `tabExitAction`: a live exit means the tab's SHELL ended (engines run
    // inside it), so close; a corpse found on reattach (host restart, reboot)
    // gets ONE resume: releasing the handle makes `engineTabSpawn` type
    // `--resume <sessionId>` on re-acquire (`spawned && !live`).
    const action = tabExitAction(active, info?.deadOnAttach === true, deps.resumeTriedRef.current.has(active.id))
    if (action === "resume") {
      deps.resumeTriedRef.current.add(active.id)
      getDefaultPtyRegistry().release(tabPtyKeyFor(taskId(), active))
      deps.bumpResetToken()
      return
    }
    if (deps.stateRef.current.tabs.length > 1) {
      closeExited(active.id)
      return
    }
    // Scratch: the last shell exiting ends the task; nothing to respawn into.
    if (deps.onScratchExit) {
      getDefaultPtyRegistry().release(tabPtyKeyFor(taskId(), active))
      deps.onScratchExit()
      return
    }
    // Last tab exited: recycle in place as a fresh engine tab (new session)
    // instead of freezing on the exit banner; `recycleTabs` keeps the title.
    getDefaultPtyRegistry().release(tabPtyKeyFor(taskId(), active))
    deps.resumeTriedRef.current.clear()
    // New tab id → new pty key, so Terminal re-acquires without a resetToken nudge.
    deps.updateRef.current(deps.pinSession(recycleTabs(deps.stateRef.current, active), undefined))
  }

  return { closeActive, closeById, closeExited, handleActiveExit }
}
