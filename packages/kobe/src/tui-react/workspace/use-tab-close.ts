/**
 * Everything about a tab going away, in one hook so the four exits below stay
 * one policy — they differ in ways that are easy to get subtly wrong, and
 * scattering them across the component is how two of them drift. Joins
 * `use-tab-dialogs` / `use-tab-handoffs` / `use-tab-lifecycle` as a per-render
 * hook (state freshness comes from being rebuilt each render, plus refs for
 * the mount-only callers).
 *
 * The four exits a tab has, and why they differ:
 *
 *   - `closeActive`   — ctrl+w. Closes the last tab too, leaving the task
 *     with none: its sidebar row stays and re-opens on ⏎ / ctrl+e. On a
 *     scratch task the last tab tears the task down instead — its whole life
 *     IS that one shell.
 *   - `closeById`     — a close named from OUTSIDE the component (the sidebar
 *     tree's menu). Same semantics as ctrl+w minus the toast.
 *   - `closeExited`   — the tab's process ended. No viewport carve-out is
 *     needed: that process is already gone.
 *   - `handleActiveExit` — the policy layer above `closeExited`, deciding
 *     between resume, close, and recycle-in-place.
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
  /** The tab the strip is showing — render-scope, so the hook is rebuilt with it. */
  readonly active: TerminalTab
  /** Mint a fresh engine-session id on the active engine tab (recycle path). */
  readonly pinSession: (state: TabsState, vendor: VendorId | undefined) => TabsState
  /** Nudge Terminal to re-acquire under the visible tab's key. */
  readonly bumpResetToken: () => void
  /** One-shot-per-tab dead-on-attach resume marks, owned by the component so
   *  they survive this hook being rebuilt every render. */
  readonly resumeTriedRef: { readonly current: Set<string> }
  /** Surface a refused close. Reachable only on a scratch task whose
   *  teardown hook is missing — an ordinary task's last tab closes. */
  readonly notifyCannotCloseLast: (tabId: string) => void
  /** Scratch task: the LAST tab going away — its shell exiting OR ctrl+w on
   *  it — ends the task itself (the host deletes the row) instead of
   *  recycling/refusing. Absent on ordinary tasks. */
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

  /** Auto-close: a tab closes itself when its process exits and
   *  releases its PTY. Reads the FRESH state — exit events can arrive from a
   *  stale render (see `handleActiveExit`). */
  function closeExited(id: string): void {
    const current = deps.stateRef.current
    const closing = current.tabs.find((tab) => tab.id === id)
    const { state: next, closedId } = closeTab(current, id)
    if (closedId) {
      const key = closing ? tabPtyKeyFor(taskId(), closing) : tabPtyKey(taskId(), closedId)
      releaseSplitLeaves(key, closing?.splitTree ?? null)
      getDefaultPtyRegistry().release(key)
      // Keep the orphan backstop from adopting the dying session back
      // before its next poll observes the exit (closed-tab-suppress.ts).
      noteClosedPtyKey(key)
    }
    deps.updateRef.current(next)
  }

  function closeById(id: string): void {
    const current = deps.stateRef.current
    const closing = current.tabs.find((tab) => tab.id === id)
    // A task may be closed down to zero tabs: its sidebar row stays and
    // re-opens on ⏎ / ctrl+e. Scratch tasks differ — their last tab going
    // away ends the task, which `closeActive` routes through `onScratchExit`.
    const { state: next, closedId } = closeTab(current, id, { allowEmpty: deps.onScratchExit === undefined })
    // Refused: nothing named `id`, or a scratch task's last tab.
    if (!closedId) return
    deps.updateRef.current(next)
    releaseClosedTabPtys(taskId(), closing, closedId)
  }

  function closeActive(): void {
    const current = deps.stateRef.current
    const closing = current.tabs.find((tab) => tab.id === current.activeId)
    // Ordinary task: ctrl+w on the last tab empties it (the row stays, and
    // re-opens on ⏎ / ctrl+e). Scratch: `closeActiveTab` still refuses, and
    // the refusal below tears the task down — its whole life IS that shell.
    const { state: next, closedId } =
      deps.onScratchExit === undefined
        ? closeTab(current, current.activeId, { allowEmpty: true })
        : closeActiveTab(current)
    if (!closedId) {
      // Scratch task: ctrl+w on its only tab tears down the
      // whole task — same zero-ceremony semantics (and same path) as the
      // shell exiting on its own. Ordinary tasks keep the refusal toast.
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
    // An exit event can be the echo of an intentional ctrl+w: closing kills
    // the PTY, which fires onExit into a STALE render before React swaps the
    // Terminal. If the tab is already gone from the fresh state there is
    // nothing to do — acting on the stale snapshot resurrects the closed tab,
    // which reads as "ctrl+w needs two presses".
    if (!deps.stateRef.current.tabs.some((tab) => tab.id === active.id)) return
    // Policy is pure (`tabExitAction`): a live exit means the tab's SHELL
    // ended (engines run inside it — `shellSpawn`), so the tab closes; a
    // corpse found on reattach (host restart, machine reboot) gets ONE resume
    // — releasing the dead handle makes `engineTabSpawn` type
    // `--resume <sessionId>` on the re-acquire (`spawned && !live`).
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
    // Scratch task: the last shell exiting IS the end of the
    // task — zero ceremony, the row disappears. No recycle: a scratch task
    // has no engine to respawn into.
    if (deps.onScratchExit) {
      getDefaultPtyRegistry().release(tabPtyKeyFor(taskId(), active))
      deps.onScratchExit()
      return
    }
    // Last tab: the strip can never be empty — recycle it in place as a fresh
    // engine tab (new session) instead of freezing on the exit banner.
    // `recycleTabs` carries the outgoing tab's title/autoTitle so the recycle does
    // not visibly rename the tab.
    getDefaultPtyRegistry().release(tabPtyKeyFor(taskId(), active))
    deps.resumeTriedRef.current.clear()
    // The recycled tab gets a NEW id, so its `${taskId}::${tabId}` pty key
    // differs and Terminal re-acquires on its own — no resetToken nudge.
    deps.updateRef.current(deps.pinSession(recycleTabs(deps.stateRef.current, active), undefined))
  }

  return { closeActive, closeById, closeExited, handleActiveExit }
}
