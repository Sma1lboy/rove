/**
 * Mirror another attached TUI's tab open/close (`terminalTab.peerSync`, relayed
 * by the daemon). Each TUI holds its own copy of a task's tabs and writes it
 * whole, so a copy that misses a peer's close brings the closed tab back on its
 * next write, and one that misses a peer's open drops it (or, two creates apart,
 * mints the same id).
 *
 * Same two routes as `addTaskTab` / `closeTaskTab`: claimed → the mounted
 * `TerminalTabs` folds it in through its writer; unclaimed → the module map and
 * kv. A task this process never opened is left alone: its copy is the disk,
 * which the peer already wrote. Everything runs under `asPeerChange`, so it is
 * neither re-reported to plugins nor echoed back out.
 */

import { useEffect } from "react"
import type { PeerTabEvent } from "../../client/remote-orchestrator-contract"
import type { PeerTabChannel } from "../../client/remote-orchestrator-peer-tabs"
import { getDefaultPtyRegistry } from "../../tui/panes/terminal/registry"
import { absorbTab } from "../../tui/workspace/tabs-adopt"
import { type CommandTab, type EngineTab, closeTab, tabPtyKeyFor } from "../../tui/workspace/terminal-tabs-core"
import { type TabsSnapshotKv, terminalTabsKey } from "./terminal-tabs-persist"
import {
  asPeerChange,
  requestPeerTabClose,
  requestTabAdd,
  setPeerTabReporter,
  setTaskTabs,
  tabsByTask,
  takeUnclaimedPeerTabClose,
  takeUnclaimedTabAdd,
} from "./terminal-tabs-shared"

/** The peer runs its own engine tab: a spawn here would start a second engine under the same key. */
function asPeerRow(tab: EngineTab | CommandTab): EngineTab | CommandTab {
  return tab.kind === "engine" ? { ...tab, spawned: true } : tab
}

export function applyPeerTabChange(kv: TabsSnapshotKv, event: PeerTabEvent): void {
  asPeerChange(() =>
    event.op === "opened"
      ? peerOpened(kv, event.taskId, asPeerRow(event.tab))
      : peerClosed(kv, event.taskId, event.tabId),
  )
}

function peerOpened(kv: TabsSnapshotKv, taskId: string, tab: EngineTab | CommandTab): void {
  requestTabAdd(taskId, tab)
  if (!takeUnclaimedTabAdd()) return
  const known = tabsByTask.get(taskId)
  if (!known) return
  const next = absorbTab(known, tab)
  if (next === known) return
  setTaskTabs(taskId, next)
  kv.set(terminalTabsKey(taskId), next)
}

function peerClosed(kv: TabsSnapshotKv, taskId: string, tabId: string): void {
  requestPeerTabClose(taskId, tabId)
  if (!takeUnclaimedPeerTabClose()) return
  const known = tabsByTask.get(taskId)
  const tab = known?.tabs.find((t) => t.id === tabId)
  if (!known || !tab) return
  const { state: next } = closeTab(known, tabId, { allowEmpty: true })
  setTaskTabs(taskId, next)
  kv.set(terminalTabsKey(taskId), next)
  releasePeerClosedPty(taskId, tab)
}

/** Drop this process's handle on the closed tab's PTY; the peer already ended the host session. */
export function releasePeerClosedPty(taskId: string, tab: Parameters<typeof tabPtyKeyFor>[1]): void {
  getDefaultPtyRegistry().release(tabPtyKeyFor(taskId, tab))
}

/** Once per host: relay this TUI's tab changes out, apply the other TUIs' in. */
export function usePeerTabSync(channel: PeerTabChannel, kv: TabsSnapshotKv): void {
  useEffect(() => {
    setPeerTabReporter(channel.report)
    const off = channel.on((event) => applyPeerTabChange(kv, event))
    return () => {
      setPeerTabReporter(null)
      off()
    }
  }, [channel, kv])
}
