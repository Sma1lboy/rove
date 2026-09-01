/**
 * Re-entering a task whose last tab you closed must give it a tab back.
 *
 * `closeTab({ allowEmpty })` (owner call 2026-08-31) lets the last tab go, and
 * `show-workspace` deliberately renders nothing for an empty tab list — mounting
 * TerminalTabs over one would mint a replacement it cannot control. That left
 * the task reachable but dead: its row was still in the sidebar, and selecting
 * it landed on a blank pane with no way out.
 *
 * `reviveEmptiedTabs` is the missing half, and this pins the states it must and
 * must NOT act on. `terminal-tabs-core.test`-adjacent coverage
 * (tab-close-scratch) locks the pure transition; this locks the kv-facing
 * decision, which is where "never opened" and "opened then emptied" are easy to
 * confuse — they are the same `tabs.length === 0` to a careless reader.
 */

import { beforeEach, describe, expect, it } from "vitest"
import { terminalTabsKey } from "../../src/tui-react/workspace/terminal-tabs-persist.ts"
import { reviveEmptiedTabs, tabsByTask } from "../../src/tui-react/workspace/terminal-tabs-shared.ts"
import type { TabsState } from "../../src/tui/workspace/terminal-tabs-core.ts"

/** The `TabsSnapshotKv` surface, backed by a plain object. */
function fakeKv(store: Record<string, unknown> = {}) {
  return {
    store,
    set(key: string, value: unknown) {
      store[key] = value
    },
  }
}

const TASK = "task-1"

beforeEach(() => {
  tabsByTask.clear()
})

describe("reviveEmptiedTabs", () => {
  it("reopens an emptied task as the kind of tab that was closed", () => {
    const emptied: TabsState = {
      tabs: [],
      activeId: "tab-1",
      nextOrdinal: 2,
      reopenAs: { kind: "command" },
    }
    const kv = fakeKv({ [terminalTabsKey(TASK)]: emptied })

    expect(reviveEmptiedTabs(kv, TASK, "/bin/zsh")).toBe(true)
    const revived = tabsByTask.get(TASK)
    expect(revived?.tabs).toHaveLength(1)
    expect(revived?.tabs[0]?.kind).toBe("command")
  })

  it("reopens a pre-reopenAs snapshot as a default engine tab", () => {
    // The upgrade path: emptied on an older build, so the hint is absent. It
    // must still reopen — a user who updates mid-session should not inherit a
    // task that refuses to open.
    const legacy: TabsState = { tabs: [], activeId: "tab-1", nextOrdinal: 2 }
    const kv = fakeKv({ [terminalTabsKey(TASK)]: legacy })

    expect(reviveEmptiedTabs(kv, TASK, "/bin/zsh")).toBe(true)
    expect(tabsByTask.get(TASK)?.tabs[0]?.kind).toBe("engine")
  })

  it("leaves a task that still has tabs alone", () => {
    // The common case by far. Reviving here would add a phantom tab on every
    // single task activation.
    const live: TabsState = {
      tabs: [{ kind: "engine", id: "tab-1", title: null, ordinal: 1 }],
      activeId: "tab-1",
      nextOrdinal: 2,
    }
    const kv = fakeKv({ [terminalTabsKey(TASK)]: live })

    expect(reviveEmptiedTabs(kv, TASK, "/bin/zsh")).toBe(false)
    expect(tabsByTask.has(TASK)).toBe(false)
  })

  it("leaves a task that has NEVER opened tabs alone", () => {
    // `null`, not empty — the distinction the whole empty-state branch rests
    // on. TerminalTabs mounts for this task and mints its own first tab;
    // publishing one here would race that with a second, session-less tab.
    const kv = fakeKv({})

    expect(reviveEmptiedTabs(kv, TASK, "/bin/zsh")).toBe(false)
    expect(tabsByTask.has(TASK)).toBe(false)
  })

  it("prefers live in-memory state over the snapshot", () => {
    // A task mounted THIS session is authoritative in `tabsByTask`; the kv
    // snapshot can lag it. Reading the stale snapshot would revive a task that
    // already has tabs open right now.
    const kv = fakeKv({ [terminalTabsKey(TASK)]: { tabs: [], activeId: "tab-1", nextOrdinal: 2 } })
    tabsByTask.set(TASK, {
      tabs: [{ kind: "engine", id: "tab-9", title: null, ordinal: 9 }],
      activeId: "tab-9",
      nextOrdinal: 10,
    })

    expect(reviveEmptiedTabs(kv, TASK, "/bin/zsh")).toBe(false)
    expect(tabsByTask.get(TASK)?.tabs[0]?.id).toBe("tab-9")
  })
})
