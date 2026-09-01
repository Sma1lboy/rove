/**
 * ctrl+w on a task's ONLY tab: a scratch task tears down the whole task
 * (issue #42 — same zero-ceremony path as its shell exiting,
 * `onScratchExit`), while an ordinary task is simply left with no tabs
 * (owner call 2026-08-31): the row stays and re-opens on ⏎ / ctrl+e.
 */

import { describe, expect, it, vi } from "vitest"

// The close hook's PTY-release imports pull in @opentui/react (TerminalSplit)
// and the live registry — neither loads under vitest's node environment, and
// neither is what this suite locks. The policy branch is.
vi.mock("../../src/tui-react/workspace/TerminalSplit.tsx", () => ({ releaseSplitLeaves: () => {} }))
vi.mock("../../src/tui-react/workspace/terminal-tabs-close.ts", () => ({ releaseClosedTabPtys: () => {} }))
vi.mock("../../src/tui/panes/terminal/registry.ts", () => ({
  getDefaultPtyRegistry: () => ({ release: () => {} }),
}))

import { useTabClose } from "../../src/tui-react/workspace/use-tab-close.ts"
import {
  type TabsState,
  type TerminalTab,
  closeTab,
  initialShellTabs,
  rehydrateTabs,
  reopenTabs,
} from "../../src/tui/workspace/terminal-tabs-core.ts"

function harness(state: TabsState, opts: { scratch?: boolean } = {}) {
  const calls = { scratchExit: 0, cannotCloseLast: 0, updates: [] as TabsState[] }
  const active = state.tabs.find((tab) => tab.id === state.activeId) as TerminalTab
  const close = useTabClose({
    stateRef: { current: state },
    propsRef: { current: { taskId: "t1" } },
    updateRef: { current: (next) => calls.updates.push(next) },
    active,
    pinSession: (s) => s,
    bumpResetToken: () => {},
    resumeTriedRef: { current: new Set() },
    notifyCannotCloseLast: () => {
      calls.cannotCloseLast += 1
    },
    ...(opts.scratch
      ? {
          onScratchExit: () => {
            calls.scratchExit += 1
          },
        }
      : {}),
  })
  return { close, calls }
}

describe("closeActive on the only tab", () => {
  it("scratch task: tears the task down instead of refusing", () => {
    const { close, calls } = harness(initialShellTabs("/bin/zsh"), { scratch: true })
    close.closeActive()
    expect(calls.scratchExit).toBe(1)
    expect(calls.cannotCloseLast).toBe(0)
    expect(calls.updates).toHaveLength(0)
  })

  it("ordinary task: closes it, leaving the task with no tabs", () => {
    // Owner call 2026-08-31. The task and its worktree stay — its sidebar row
    // remains and re-opens on ⏎ / ctrl+e — so there is nothing to warn about.
    const { close, calls } = harness(initialShellTabs("/bin/zsh"))
    close.closeActive()
    expect(calls.cannotCloseLast).toBe(0)
    expect(calls.updates).toHaveLength(1)
    expect(calls.updates[0]?.tabs).toEqual([])
  })
})

describe("closing down to zero tabs (owner call 2026-08-31)", () => {
  it("an emptied task keeps its snapshot empty across a remount", () => {
    // The close only appears to take if rehydration honours it. Without
    // `allowEmpty` the task grows a fresh tab back on the next mount, and
    // ctrl+w reads as a no-op.
    const emptied: TabsState = { tabs: [], activeId: "tab-1", nextOrdinal: 2 }
    expect(rehydrateTabs(emptied, ["/bin/zsh"], { allowEmpty: true }).tabs).toEqual([])
  })

  it("a CORRUPT snapshot still recovers a tab", () => {
    // Same empty shape, opposite intent: this is the case the fallback was
    // written for, so the default must keep healing it.
    const corrupt: TabsState = { tabs: [], activeId: "tab-1", nextOrdinal: 2 }
    expect(rehydrateTabs(corrupt, ["/bin/zsh"]).tabs).toHaveLength(1)
  })

  it("records what the closed tab WAS, so re-entry reopens the same kind", () => {
    // Owner ask 2026-08-31: re-entering an emptied task should bring back the
    // kind of session that was there, not always an engine.
    const shellOnly: TabsState = {
      tabs: [{ kind: "command", id: "tab-1", title: null, ordinal: 1, command: ["/bin/zsh"] }],
      activeId: "tab-1",
      nextOrdinal: 2,
    }
    const emptied = closeTab(shellOnly, "tab-1", { allowEmpty: true }).state
    expect(emptied.tabs).toEqual([])
    expect(emptied.reopenAs).toEqual({ kind: "command" })

    const revived = reopenTabs(emptied, "/bin/zsh")
    expect(revived.tabs).toHaveLength(1)
    expect(revived.tabs[0]?.kind).toBe("command")
    // A fresh id, never the closed tab's: ordinals are monotonic, and the PTY
    // registry keys on `taskId::tabId` — reusing the id would collide with the
    // entry the close just released.
    expect(revived.tabs[0]?.id).toBe("tab-2")
    expect(revived.activeId).toBe("tab-2")
  })

  it("an engine tab reopens as an engine, keeping its per-tab vendor", () => {
    const engineOnly: TabsState = {
      tabs: [{ kind: "engine", id: "tab-1", title: null, ordinal: 1, vendor: "codex" }],
      activeId: "tab-1",
      nextOrdinal: 2,
    }
    const emptied = closeTab(engineOnly, "tab-1", { allowEmpty: true }).state
    const revived = reopenTabs(emptied, "/bin/zsh")
    expect(revived.tabs[0]?.kind).toBe("engine")
    expect(revived.tabs[0]).toMatchObject({ vendor: "codex" })
    // The session is NOT carried: that PTY died with the tab, so reviving it
    // would resume a conversation that no longer has a process.
    expect(revived.tabs[0]).not.toHaveProperty("sessionId")
  })

  it("a snapshot written before reopenAs existed falls back to a default engine tab", () => {
    // The upgrade path (owner ask): an install that emptied a task on an older
    // build has no `reopenAs`, and must still reopen rather than stay stuck.
    const legacy: TabsState = { tabs: [], activeId: "tab-1", nextOrdinal: 2 }
    const revived = reopenTabs(legacy, "/bin/zsh")
    expect(revived.tabs).toHaveLength(1)
    expect(revived.tabs[0]?.kind).toBe("engine")
    expect(revived.activeId).toBe("tab-2")
  })

  it("closeTab refuses to empty a task unless asked", () => {
    const one: TabsState = {
      tabs: [{ kind: "engine", id: "tab-1", title: null, ordinal: 1 }],
      activeId: "tab-1",
      nextOrdinal: 2,
    }
    expect(closeTab(one, "tab-1").closedId).toBeNull()
    expect(closeTab(one, "tab-1", { allowEmpty: true }).closedId).toBe("tab-1")
  })
})
