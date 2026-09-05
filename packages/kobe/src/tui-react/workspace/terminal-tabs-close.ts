/**
 * Close a tab of ANY task — mounted or not.
 *
 * The sidebar tree lists every worktree's tabs, so "close this tab" can name a
 * task whose `TerminalTabs` is not on screen and therefore owns no React state
 * to update. Two routes, one entry point:
 *
 *   - **Mounted** — hand the request to the component (it holds the state, the
 *     kv write, and the `tab.closed` plugin event) and let it do its own close.
 *   - **Not mounted** — write the module map + kv snapshot here and release the
 *     PTYs directly, the mirror of `appendBackgroundEngineTab`.
 *
 * Which one applies is not guessed: `requestTabClose` notifies the listener set
 * synchronously, so a request that is still pending afterwards was claimed by
 * nobody. That keeps the two paths from ever both firing.
 *
 * Split from `terminal-tabs-shared.ts` so that module keeps its narrow import
 * surface — this one reaches into the PTY registry and the split helper.
 */

import { logClientError } from "@sma1lboy/kobe-daemon/client/client-log"
import { peekSharedPtyClient } from "../../tui/panes/terminal/pty-hosted-client"
import { getDefaultPtyRegistry } from "../../tui/panes/terminal/registry"
import { noteClosedPtyKey } from "../../tui/workspace/closed-tab-suppress"
import { type TerminalTab, closeTab, tabPtyKey, tabPtyKeyFor } from "../../tui/workspace/terminal-tabs-core"
import { releaseSplitLeaves } from "./TerminalSplit"
import { type TabsSnapshotKv, terminalTabsKey } from "./terminal-tabs-persist"
import {
  knownTabsState,
  reportTabsDelta,
  requestTabClose,
  setTaskTabs,
  takeUnclaimedTabClose,
} from "./terminal-tabs-shared"

/**
 * Release a closing tab's PTYs — the split leaves plus the tab's own.
 *
 * A viewport tab (`ptyTask`) only VIEWS another task's session, so closing the
 * view must not kill it; the referenced task still owns and resumes it. Same
 * carve-out `chat.tab.close` makes.
 */
export function releaseClosedTabPtys(taskId: string, closing: TerminalTab | undefined, closedId: string): void {
  const key = closing ? tabPtyKeyFor(taskId, closing) : tabPtyKey(taskId, closedId)
  releaseSplitLeaves(key, closing?.splitTree ?? null)
  if (closing?.kind === "engine" && closing.ptyTask) return
  // The sidebar's orphan backstop polls the host on a 2s tick; until it
  // observes this kill it still lists the session as live, and would adopt
  // it right back into the state (ctrl+w needing two presses). Note the key
  // so orphan detection skips it while the death propagates.
  noteClosedPtyKey(key)
  const registry = getDefaultPtyRegistry()
  // `release()` can only kill what THIS process holds a handle for, and the
  // sidebar closes tabs of tasks it never attached to (a task not mounted
  // since the TUI started owns no local handle). Its hosted session then
  // outlived the row that named it — an engine running with no UI presence,
  // which is exactly the divergence `tabs-adopt.ts` has to clean up after.
  // So when there is no handle, tell the host directly.
  const local = registry.get(key)
  registry.release(key)
  if (!local) killHostedSession(key)
}

/**
 * Best-effort `pty.kill` for a key with no local handle, over the shared
 * connection IF this process has one — dialing the host here would let a tab
 * close pin a client (see `peekSharedPtyClient`), which is how a render test
 * starves the suite that owns the real socket.
 *
 * A skipped or failed kill is NOT "the same outcome as the kill succeeding",
 * which is what this used to claim. A kill reaches `freeze.drop` and the
 * record is gone; a miss leaves it on disk with a fresh `updatedAt`, and the
 * next pty host inside the 14-day TTL thaws it back into a restored session —
 * the tab the user explicitly closed returns with its old scrollback and its
 * engine still running, against the promise in `docs/SESSIONS.md` that an
 * intentional end is never resurrected.
 *
 * So the miss is recorded rather than swallowed. It is still a miss: this
 * process cannot both stay out of the connection cache and reach the host.
 */
function killHostedSession(key: string): void {
  const client = peekSharedPtyClient()
  if (!client) {
    logClientError("pty", new Error(`pty.kill skipped for ${key}: no shared pty client in this process`))
    return
  }
  void client
    .then((c) => c.request("pty.kill", { key }))
    .catch((err) => {
      logClientError(
        "pty",
        new Error(`pty.kill failed for ${key}: ${err instanceof Error ? err.message : String(err)}`),
      )
    })
}

/**
 * Close `tabId` of `taskId`. Returns whether anything closed — false means the
 * task named no such tab (or has never opened any), which is the one case the
 * caller surfaces as "that didn't happen". Closing the LAST tab succeeds: it
 * empties the list and leaves the row, exactly as the mounted path does.
 */
export function closeTaskTab(kv: TabsSnapshotKv, taskId: string, tabId: string): boolean {
  const state = knownTabsState(kv, taskId)
  // Check before publishing: a mounted component claims requests by task, so
  // publishing an unknown id first would look like a successful close even
  // though closeById made no state transition.
  if (!state || !state.tabs.some((tab) => tab.id === tabId)) return false
  requestTabClose(taskId, tabId)
  const unclaimed = takeUnclaimedTabClose()
  // Claimed: the mounted TerminalTabs already ran its own close path.
  if (!unclaimed) return true

  const closing = state.tabs.find((tab) => tab.id === tabId)
  // `allowEmpty`, matching the mounted path (`useTabClose`): a task's last tab
  // may go, leaving the row to be revived on re-entry (`reviveEmptiedTabs`).
  // Without it these two routes disagreed about the SAME gesture — the tree
  // offers one close action over every task's tabs, and which of those tasks
  // happens to be mounted is invisible, so closing the last tab of a
  // background task failed while the identical click on the focused one
  // worked. Scratch tasks are unaffected: their teardown-on-last-tab lives in
  // `closeActive`, which the sidebar never reaches.
  const { state: next, closedId } = closeTab(state, tabId, { allowEmpty: true })
  if (!closedId) return false
  setTaskTabs(taskId, next)
  kv.set(terminalTabsKey(taskId), next)
  reportTabsDelta(taskId, state.tabs, next.tabs)
  releaseClosedTabPtys(taskId, closing, closedId)
  return true
}
