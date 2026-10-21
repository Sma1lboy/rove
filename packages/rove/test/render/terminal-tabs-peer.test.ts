/**
 * Peer tab sync: one TUI's open/close reaches the other TUIs attached to the
 * same daemon (`terminalTab.peerSync`), and applying it is silent. These are the
 * four steps that broke with two TUIs on one task:
 *   1. A opens a tab → B lists it (before: only via the 2s orphan poll).
 *   2. A closes it → B drops it (before: B kept a ghost row).
 *   3. B's next write no longer revives it (before: whole-key write brought it back, respawned).
 *   4. B's next new tab gets a fresh id (before: both minted the same `tab-N`).
 *
 * Bun render track: the module reaches the PTY registry, which pulls in opentui.
 */

import { afterEach, expect, test } from "bun:test"
import type { PeerTabEvent } from "../../src/client/remote-orchestrator-contract"
import { applyPeerTabChange } from "../../src/tui-react/workspace/terminal-tabs-peer"
import { terminalTabsKey } from "../../src/tui-react/workspace/terminal-tabs-persist"
import {
  type PeerTabChange,
  reportTabsDelta,
  setPeerTabReporter,
  setUiEventReporter,
  tabActivationListeners,
  tabsByTask,
  takePeerTabClose,
} from "../../src/tui-react/workspace/terminal-tabs-shared"
import { isRecentlyClosedPtyKey } from "../../src/tui/workspace/closed-tab-suppress"
import { type EngineTab, type TabsState, addTab, tabPtyKey } from "../../src/tui/workspace/terminal-tabs-core"

function engine(id: string, ordinal: number): EngineTab {
  return { kind: "engine", id, title: null, ordinal, vendor: "claude" }
}

function state(ids: readonly string[], activeId = ids[0] ?? "tab-1"): TabsState {
  return { tabs: ids.map((id, i) => engine(id, i + 1)), activeId, nextOrdinal: ids.length + 1 }
}

function fakeKv() {
  const store: Record<string, unknown> = {}
  return {
    store,
    set(key: string, value: unknown) {
      store[key] = value
    },
  }
}

const at = Date.now()
const opened = (taskId: string, tab: EngineTab): PeerTabEvent => ({ op: "opened", taskId, tab, origin: "A", at })
const closed = (taskId: string, tabId: string): PeerTabEvent => ({ op: "closed", taskId, tabId, origin: "A", at })

/** What this TUI tells plugins and peers while the test runs. */
function recordReports() {
  const plugin: string[] = []
  const peer: PeerTabChange[] = []
  setUiEventReporter((kind, _taskId, detail) => plugin.push(`${kind}:${String(detail?.tabId)}`))
  setPeerTabReporter((change) => peer.push(change))
  return { plugin, peer }
}

afterEach(() => {
  setUiEventReporter(null)
  setPeerTabReporter(null)
  tabsByTask.clear()
})

test("a peer's new tab joins this copy, as already running, and moves nextOrdinal past it", () => {
  tabsByTask.set("t1", state(["tab-1", "tab-2"]))
  const kv = fakeKv()
  const reports = recordReports()

  applyPeerTabChange(kv, opened("t1", engine("tab-3", 3)))

  const next = tabsByTask.get("t1")
  expect(next?.tabs.map((tab) => tab.id)).toEqual(["tab-1", "tab-2", "tab-3"])
  // The peer runs that engine: spawning here would start a second one under the same key.
  expect(next?.tabs[2]).toMatchObject({ spawned: true })
  // Step 4: this TUI's next tab can't reuse tab-3.
  expect(addTab(next as TabsState, "claude").activeId).toBe("tab-4")
  expect((kv.store[terminalTabsKey("t1")] as TabsState).tabs).toHaveLength(3)
  // Silent: the peer already told plugins, and it must not bounce back out.
  expect(reports).toEqual({ plugin: [], peer: [] })
})

test("a peer's close drops the row, so this copy's later writes cannot bring it back", () => {
  tabsByTask.set("t1", state(["tab-1", "tab-2", "tab-3"], "tab-3"))
  const kv = fakeKv()
  const reports = recordReports()

  applyPeerTabChange(kv, closed("t1", "tab-3"))

  const next = tabsByTask.get("t1")
  expect(next?.tabs.map((tab) => tab.id)).toEqual(["tab-1", "tab-2"])
  expect(next?.activeId).toBe("tab-2")
  expect((kv.store[terminalTabsKey("t1")] as TabsState).tabs.map((tab) => tab.id)).toEqual(["tab-1", "tab-2"])
  expect(reports).toEqual({ plugin: [], peer: [] })
})

test("a mounted owner claims the peer close; the background write does not also run", () => {
  const before = state(["tab-1", "tab-2"])
  tabsByTask.set("t1", before)
  const claimed: string[] = []
  const listener = () => {
    const id = takePeerTabClose("t1")
    if (id) claimed.push(id)
  }
  tabActivationListeners.add(listener)
  try {
    applyPeerTabChange(fakeKv(), closed("t1", "tab-2"))
  } finally {
    tabActivationListeners.delete(listener)
  }
  expect(claimed).toEqual(["tab-2"])
  expect(tabsByTask.get("t1")).toBe(before)
})

test("a task this TUI never opened is left to the disk the peer already wrote", () => {
  const kv = fakeKv()
  applyPeerTabChange(kv, opened("t9", engine("tab-2", 2)))
  applyPeerTabChange(kv, closed("t9", "tab-1"))
  expect(tabsByTask.has("t9")).toBe(false)
  expect(kv.store).toEqual({})
})

test("this TUI's own open and close go to plugins once and to the peers", () => {
  const reports = recordReports()
  const prev = state(["tab-1", "tab-2"]).tabs
  const added = [...prev, engine("tab-3", 3)]
  reportTabsDelta("t1", prev, added)
  reportTabsDelta("t1", added, prev)
  expect(reports.plugin).toEqual(["tab.opened:tab-3", "tab.closed:tab-3"])
  expect(reports.peer).toEqual([
    { op: "opened", taskId: "t1", tab: engine("tab-3", 3), after: "tab-2" },
    { op: "closed", taskId: "t1", tabId: "tab-3" },
  ])
})

test("a changed row (a pinned session id) is relayed to peers but is not a plugin event", () => {
  const reports = recordReports()
  const prev = state(["tab-1"]).tabs
  const pinned = { ...engine("tab-1", 1), sessionId: "s-1" }
  reportTabsDelta("t1", prev, [pinned])
  expect(reports.plugin).toEqual([])
  expect(reports.peer).toEqual([{ op: "opened", taskId: "t1", tab: pinned }])
})

test("a peer's new tab lands where its creator put it, so both copies keep one order", () => {
  tabsByTask.set("t1", state(["tab-1", "tab-2", "tab-3"]))
  applyPeerTabChange(fakeKv(), { ...opened("t1", engine("tab-4", 4)), after: "tab-1" } as PeerTabEvent)
  expect(tabsByTask.get("t1")?.tabs.map((tab) => tab.id)).toEqual(["tab-1", "tab-4", "tab-2", "tab-3"])
})

test("a peer-closed session is not re-adopted by the orphan poll before the host sees it exit", () => {
  tabsByTask.set("t1", state(["tab-1", "tab-2"]))
  applyPeerTabChange(fakeKv(), closed("t1", "tab-2"))
  expect(isRecentlyClosedPtyKey(tabPtyKey("t1", "tab-2"))).toBe(true)
})
