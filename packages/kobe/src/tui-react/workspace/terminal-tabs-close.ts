/**
 * Close a tab of ANY task — the sidebar tree can name a task whose
 * `TerminalTabs` isn't mounted and owns no React state:
 *
 *   - **Mounted** — the component claims the request and runs its own close
 *     (state, kv write, `tab.closed` plugin event).
 *   - **Not mounted** — write the module map + kv here and release PTYs
 *     directly, mirroring `appendBackgroundEngineTab`.
 *
 * `requestTabClose` notifies listeners synchronously, so a request still pending
 * afterwards was claimed by nobody — the two paths can never both fire. Kept out
 * of `terminal-tabs-shared.ts` to keep that module's imports narrow.
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
 * Release a closing tab's split leaves and its own PTY. A viewport tab
 * (`ptyTask`) only views another task's session, so it isn't killed — same
 * carve-out as `chat.tab.close`.
 */
export function releaseClosedTabPtys(taskId: string, closing: TerminalTab | undefined, closedId: string): void {
  const key = closing ? tabPtyKeyFor(taskId, closing) : tabPtyKey(taskId, closedId)
  releaseSplitLeaves(key, closing?.splitTree ?? null)
  if (closing?.kind === "engine" && closing.ptyTask) return
  // The orphan backstop polls the host every 2s and would re-adopt the session
  // before it sees the kill (ctrl+w needing two presses); note the key so
  // orphan detection skips it meanwhile.
  noteClosedPtyKey(key)
  const registry = getDefaultPtyRegistry()
  // `release()` only kills handles THIS process holds; a task never mounted
  // since startup has none, and its hosted engine would outlive its row (the
  // divergence `tabs-adopt.ts` cleans up). So tell the host directly.
  const local = registry.get(key)
  registry.release(key)
  if (!local) killHostedSession(key)
}

/**
 * Best-effort `pty.kill` over the shared connection only IF one exists —
 * dialing here would let a tab close pin a client (`peekSharedPtyClient`),
 * which starves a suite that owns the real socket.
 *
 * A missed kill is NOT harmless: a kill reaches `freeze.drop`, but a miss
 * leaves the record on disk with a fresh `updatedAt`, and the next pty host
 * within the 14-day TTL thaws it — the closed tab returns with its scrollback
 * and a running engine, breaking `docs/SESSIONS.md`'s "intentional end is never
 * resurrected". So misses are logged, not swallowed.
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
 * Close `tabId` of `taskId`; false only when the task has no such tab (the
 * case the caller reports). Closing the LAST tab succeeds and leaves the row,
 * as the mounted path does.
 */
export function closeTaskTab(kv: TabsSnapshotKv, taskId: string, tabId: string): boolean {
  const state = knownTabsState(kv, taskId)
  // Check before publishing: a mounted component claims by task, so an unknown
  // id would look like a successful close with no state transition.
  if (!state || !state.tabs.some((tab) => tab.id === tabId)) return false
  requestTabClose(taskId, tabId)
  const unclaimed = takeUnclaimedTabClose()
  // Claimed: the mounted TerminalTabs already ran its own close path.
  if (!unclaimed) return true

  const closing = state.tabs.find((tab) => tab.id === tabId)
  // `allowEmpty` matches the mounted path (`useTabClose`) so the same tree
  // gesture behaves the same whether or not the task is mounted; the row is
  // revived on re-entry (`reviveEmptiedTabs`). Scratch teardown-on-last-tab
  // lives in `closeActive`, which the sidebar never reaches.
  const { state: next, closedId } = closeTab(state, tabId, { allowEmpty: true })
  if (!closedId) return false
  setTaskTabs(taskId, next)
  kv.set(terminalTabsKey(taskId), next)
  reportTabsDelta(taskId, state.tabs, next.tabs)
  releaseClosedTabPtys(taskId, closing, closedId)
  return true
}
