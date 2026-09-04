/** @jsxImportSource @opentui/react */
/**
 * The center column's EMPTY states.
 *
 * Two are derived from the orchestrator's task list: zero tasks teaches (the
 * welcome panel), anything else keeps the terse "select a task" line, so an
 * existing user never gets the onboarding copy back.
 *
 * The third is per-task: a task whose tabs are KNOWN and empty (you closed the
 * last one) renders a placeholder INSTEAD of mounting TerminalTabs. That
 * component's `active` tab is non-null by construction, so mounting it for an
 * empty task would immediately mint a replacement and the close would never
 * appear to take.
 */

import { describe, expect, it } from "bun:test"
import type { RemoteOrchestrator } from "../../src/client/remote-orchestrator"
import { ShowWorkspace } from "../../src/tui-react/workspace/show-workspace"
import { tabsByTask } from "../../src/tui-react/workspace/terminal-tabs-shared"
import type { Task } from "../../src/types/task"
import { act, renderComponent } from "./harness"

// useAccessor drives useSyncExternalStore, which re-renders whenever the
// snapshot's IDENTITY changes — a `get: () => ({})` stub returns a fresh
// value every call and loops forever. Every snapshot here is a frozen constant.
const EMPTY = Object.freeze({})
const NO_TASKS = Object.freeze([]) as readonly Task[]
const ONE_TASK = Object.freeze([{ id: "t1" }]) as unknown as readonly Task[]

const store = <T,>(value: T) => ({ subscribe: () => () => {}, get: () => value })

const orchestratorWith = (tasks: readonly Task[]): RemoteOrchestrator =>
  ({
    transcriptActivityStore: () => store(EMPTY),
    engineTabStatesSignal: () => store(EMPTY),
    tasksSignal: () => store(tasks),
  }) as unknown as RemoteOrchestrator

const props = (tasks: readonly Task[]) =>
  ({
    task: undefined,
    worktree: null,
    orchestrator: orchestratorWith(tasks),
    focused: false,
    onRequestFocus: () => {},
    onEditorTabReady: () => {},
    onEngineSendReady: () => {},
    onEnginePasteReady: () => {},
    onDiffTabReady: () => {},
    onQuickFork: () => {},
  }) as const

const frameFor = async (tasks: readonly Task[]): Promise<string> => {
  const { frame } = await renderComponent(<ShowWorkspace {...props(tasks)} />)
  // Flush the welcome panel's mount-effect environment probe.
  await act(async () => {})
  return await frame()
}

describe("ShowWorkspace empty states", () => {
  it("teaches when no task exists at all", async () => {
    expect(await frameFor(NO_TASKS)).toContain("Welcome to Rove")
  })

  it("keeps the terse placeholder once a live task exists", async () => {
    expect(await frameFor(ONE_TASK)).not.toContain("Welcome to Rove")
  })
})

/** A selected task with a worktree — the shape that normally mounts tabs. */
const SELECTED = { id: "t1", repo: "/repos/rove", kind: "task" } as unknown as Task

const frameForTask = async (task: Task): Promise<string> => {
  const { frame } = await renderComponent(<ShowWorkspace {...props(ONE_TASK)} task={task} worktree="/wt/t1" />)
  await act(async () => {})
  return await frame()
}

describe("a task whose last tab was closed", () => {
  it("renders the no-sessions placeholder instead of mounting tabs", async () => {
    tabsByTask.clear()
    // KNOWN and empty: the user closed the last tab.
    tabsByTask.set("t1", { tabs: [], activeId: "tab-1", nextOrdinal: 2 })
    expect(await frameForTask(SELECTED)).toContain("No sessions here")
  })

  it("mounts normally when the tabs are merely UNKNOWN", async () => {
    // Absent from the map = never mounted since restart, which is every task
    // on a cold boot. Treating that as empty would leave the workspace blank.
    tabsByTask.clear()
    expect(await frameForTask(SELECTED)).not.toContain("No sessions here")
  })

  it("mounts normally while a tab is open", async () => {
    tabsByTask.clear()
    tabsByTask.set("t1", {
      tabs: [{ kind: "engine", id: "tab-1", title: null, ordinal: 1 }],
      activeId: "tab-1",
      nextOrdinal: 2,
    })
    expect(await frameForTask(SELECTED)).not.toContain("No sessions here")
  })
})

/**
 * An experimental remote (`ssh://`) project. The worktree is on the other
 * machine and the PTY host only spawns locally, so the launch builder refuses
 * — and a refusal thrown from inside TerminalTabs reaches the user as
 * "This pane crashed", which names nothing. Not mounting is the whole fix.
 */
describe("a task on a remote ssh:// project", () => {
  const REMOTE = { id: "t1", repo: "ssh://me@buildbox", kind: "task" } as unknown as Task

  const frameForRemote = async (task: Task, worktree: string): Promise<string> => {
    tabsByTask.clear()
    const { frame } = await renderComponent(<ShowWorkspace {...props(ONE_TASK)} task={task} worktree={worktree} />)
    await act(async () => {})
    return await frame()
  }

  it("says what is unimplemented instead of mounting an engine tab", async () => {
    const frame = await frameForRemote(REMOTE, "/srv/rove/me-buildbox/t1")
    expect(frame).toContain("SSH is not implemented")
    expect(frame).toContain("ssh://me@buildbox")
  })

  it("catches a remote WORKTREE under a repo key that reads local", async () => {
    expect(await frameForRemote(SELECTED, "ssh://me@buildbox/srv/rove/t1")).toContain("SSH is not implemented")
  })

  it("leaves a local task mounting as before", async () => {
    expect(await frameForRemote(SELECTED, "/wt/t1")).not.toContain("SSH is not implemented")
  })
})
