/** @jsxImportSource @opentui/react */
/**
 * The center column's two EMPTY states. Which one renders is derived from the
 * orchestrator's task list: zero tasks teaches (the welcome panel), anything
 * else keeps the terse "select a task" line, so an existing user never gets
 * the onboarding copy back.
 */

import { describe, expect, it } from "bun:test"
import type { RemoteOrchestrator } from "../../src/client/remote-orchestrator"
import { ShowWorkspace } from "../../src/tui-react/workspace/show-workspace"
import type { Task } from "../../src/types/task"
import { act, renderComponent } from "./harness"

// useAccessor drives useSyncExternalStore, which re-renders whenever the
// snapshot's IDENTITY changes — a `get: () => ({})` stub returns a fresh
// value every call and loops forever. Every snapshot here is a frozen constant.
const EMPTY = Object.freeze({})
const NO_TASKS = Object.freeze([]) as readonly Task[]
const ONE_TASK = Object.freeze([{ id: "t1", archived: false }]) as unknown as readonly Task[]

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
