/** @jsxImportSource @opentui/react */
/**
 * Closing the LAST tab is a TRANSITION, not a start state.
 *
 * show-workspace-empty.test.tsx seeds `tabsByTask` before the first render, so
 * ShowWorkspace decides once and never re-decides — which is exactly what the
 * real close is not. The close happens the other way round: the tab list
 * empties while the component is already mounted, and the decision to stop
 * mounting TerminalTabs has to arrive from `tabsByTask`, a module-level Map
 * React cannot observe on its own.
 *
 * The transition is driven here from the KNOWN-EMPTY side (empty -> one tab)
 * rather than the other way: both directions need the same subscription, and
 * this one never mounts TerminalTabs, which opens a daemon socket and needs
 * four more providers. What is under test is whether ShowWorkspace re-decides
 * at all when the map changes under it.
 */

import { describe, expect, it } from "bun:test"
import type { RemoteOrchestrator } from "../../src/client/remote-orchestrator"
import { ShowWorkspace } from "../../src/tui-react/workspace/show-workspace"
import { setTaskTabs, tabsByTask } from "../../src/tui-react/workspace/terminal-tabs-shared"
import type { Task } from "../../src/types/task"
import { act, renderComponent } from "./harness"

const EMPTY_MAP = new Map<string, never>()
const ONE_TASK = Object.freeze([{ id: "t1" }]) as unknown as readonly Task[]
const store = <T,>(value: T) => ({ subscribe: () => () => {}, get: () => value })

const orchestrator = () =>
  ({
    transcriptActivityStore: () => store(EMPTY_MAP),
    engineTabStatesSignal: () => store(EMPTY_MAP),
    tasksSignal: () => store(ONE_TASK),
  }) as unknown as RemoteOrchestrator

const SELECTED = { id: "t1", repo: "/repos/rove", kind: "task" } as unknown as Task

const props = () =>
  ({
    task: SELECTED,
    worktree: "/wt/t1",
    orchestrator: orchestrator(),
    focused: false,
    onRequestFocus: () => {},
    onEditorTabReady: () => {},
    onEngineSendReady: () => {},
    onEnginePasteReady: () => {},
    onDiffTabReady: () => {},
    onQuickFork: () => {},
  }) as const

describe("the tab map changing under a mounted ShowWorkspace", () => {
  it("re-decides when the task's tabs change after first render", async () => {
    tabsByTask.clear()
    tabsByTask.set("t1", { tabs: [], activeId: "tab-1", nextOrdinal: 2 })

    const { frame } = await renderComponent(<ShowWorkspace {...props()} />)
    await act(async () => {})
    expect(await frame()).toContain("No sessions here")

    // A session opens again (⏎ / ctrl+e on the empty row) — the same
    // module-map write closing the last tab performs, in reverse.
    await act(async () => {
      setTaskTabs("t1", {
        tabs: [{ kind: "engine", id: "tab-1", title: null, ordinal: 1 }],
        activeId: "tab-1",
        nextOrdinal: 2,
      })
    })

    // Before the revision subscription this frame still read "No sessions
    // here": the map had changed and nothing told React to look again.
    expect(await frame()).not.toContain("No sessions here")
  })
})
