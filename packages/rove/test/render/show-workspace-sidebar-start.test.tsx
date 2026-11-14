/** @jsxImportSource @opentui/react */
import { afterEach, describe, expect, it, spyOn } from "bun:test"
import { RoveDaemonClient } from "@sma1lboy/rove-daemon/client"
import { RemoteOrchestrator } from "../../src/client/remote-orchestrator"
import * as engines from "../../src/engine/account-detect"
import * as terminalTabs from "../../src/tui-react/workspace/TerminalTabs"
import type { ChildSpawnRequest } from "../../src/tui-react/workspace/quick-fork"
import { ShowWorkspace } from "../../src/tui-react/workspace/show-workspace"
import {
  requestNewTab,
  reviveEmptiedTabs,
  tabsByTask,
  takeNewTab,
} from "../../src/tui-react/workspace/terminal-tabs-shared"
import { defaultShell } from "../../src/tui/panes/terminal/pty-types"
import { type Task, toTaskId } from "../../src/types/task"
import { act, renderComponent, waitForFrameText } from "./harness"

const restore: (() => void)[] = []
afterEach(() => {
  for (const reset of restore.splice(0)) reset()
})

type Kind = "main" | "dir"
type Timing = "before mount" | "while mounted"

/** Mount ShowWorkspace for a `kind` checkout and issue the sidebar's explicit start `timing` the mount. */
async function startFromSidebar(kind: Kind, action: "chat" | "shell", timing: Timing) {
  const id = toTaskId(`sidebar-start-${kind}-${action}-${timing}`)
  const task: Task = {
    id,
    kind,
    title: "Checkout",
    repo: "/tmp/checkout",
    worktreePath: "/tmp/checkout",
    branch: "",
    status: "in_progress",
    vendor: "claude",
    createdAt: "2026-10-20T00:00:00Z",
    updatedAt: "2026-10-20T00:00:00Z",
  }
  const available = spyOn(engines, "availableEngineIds").mockResolvedValue(["claude", "codex"])
  // Replace only PTY hosting; ShowWorkspace and the empty pane stay real.
  const host = spyOn(terminalTabs, "TerminalTabs").mockImplementation(() => <text>Tabs mounted</text>)
  restore.push(
    () => available.mockRestore(),
    () => host.mockRestore(),
  )
  const spawned: ChildSpawnRequest[] = []
  const start = () => {
    reviveEmptiedTabs(null, id, defaultShell())
    requestNewTab(id, action)
  }
  if (timing === "before mount") start()
  const view = await renderComponent(
    <ShowWorkspace
      task={task}
      worktree={task.worktreePath}
      orchestrator={new RemoteOrchestrator(new RoveDaemonClient("/unused-sidebar-start.sock"))}
      focused={true}
      onRequestFocus={() => {}}
      onEditorTabReady={() => {}}
      onEngineSendReady={() => {}}
      onEnginePasteReady={() => {}}
      onDiffTabReady={() => {}}
      onSpawnChild={(request) => spawned.push(request)}
      onQuickFork={() => {}}
    />,
    { providers: { dialog: true } },
  )
  if (timing === "while mounted") {
    expect(await view.frame()).toContain("No sessions here")
    await act(async () => start())
  }
  return { id, view, spawned }
}

const TIMINGS: Timing[] = ["before mount", "while mounted"]

describe.each(["main", "dir"] as const)("%s sidebar New chat", (kind) => {
  it.each(TIMINGS)("consumes an explicit start %s", async (timing) => {
    const { id, view } = await startFromSidebar(kind, "chat", timing)
    await waitForFrameText(view.frame, "New conversation", { timeoutMs: 1000 })
    expect(tabsByTask.has(id)).toBe(false)
    await act(async () => {
      view.mockInput.pressArrow("right")
    })
    await act(async () => {
      view.mockInput.pressEnter()
    })
    await waitForFrameText(view.frame, "Tabs mounted", { timeoutMs: 1000 })
    const tabs = tabsByTask.get(id)?.tabs
    expect(tabs).toHaveLength(1)
    expect(tabs?.[0]).toMatchObject({ kind: "engine", vendor: "codex", engineCommand: "codex" })
    expect(takeNewTab(id)).toBeNull()
  })
})

describe.each(["main", "dir"] as const)("%s sidebar New shell", (kind) => {
  it.each(TIMINGS)("consumes an explicit start %s", async (timing) => {
    const { id, view, spawned } = await startFromSidebar(kind, "shell", timing)
    // A shell is its own row: a child task whose tab-1 is the shell, not a tab of this task.
    await waitForFrameText(view.frame, "No sessions here", { timeoutMs: 1000 })
    expect(spawned).toHaveLength(1)
    expect(spawned[0]).toMatchObject({ parentTaskId: id, title: "shell" })
    expect(spawned[0]?.tabs?.tabs).toMatchObject([{ kind: "command", id: "tab-1", command: [defaultShell()] }])
    expect(takeNewTab(id)).toBeNull()
  })
})
