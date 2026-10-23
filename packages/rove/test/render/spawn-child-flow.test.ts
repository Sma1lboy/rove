/**
 * `runSpawnChild` (`workspace/quick-fork.ts`) — what ctrl+t, the picker's tab
 * destination and the sidebar's "New conversation" do, against a stub
 * orchestrator: a shared child of the current task, then select + enter it.
 */

import { describe, expect, test } from "bun:test"
import { forkFirstTab } from "../../src/tui-react/workspace/fork-chat-tab"
import { runSpawnChild } from "../../src/tui-react/workspace/quick-fork"
import { tabsByTask } from "../../src/tui-react/workspace/terminal-tabs-shared"
import { type Task, toTaskId } from "../../src/types/task"

function stub(fail?: Error) {
  const spawned: unknown[] = []
  const steps: string[] = []
  const errors: string[] = []
  return {
    spawned,
    steps,
    errors,
    orch: {
      async spawnChildTask(input: unknown) {
        if (fail) throw fail
        spawned.push(input)
        return { task: { id: toTaskId("kid") } as Task }
      },
    },
    hooks: {
      selectTask: (id: string) => {
        // The child's first mount reads its tabs, so they must exist by the time it is shown.
        steps.push(`select ${id} tabs=${tabsByTask.has(id)}`)
      },
      enterTask: async (id: string) => {
        steps.push(`enter ${id}`)
      },
      notifyError: (message: string) => errors.push(message),
    },
  }
}

describe("runSpawnChild", () => {
  test("spawns a child that shares the directory, then selects and enters it", async () => {
    const s = stub()
    const id = await runSpawnChild(s.orch, { parentTaskId: "parent", vendor: "codex" }, s.hooks)

    expect(id).toBe("kid")
    expect(s.spawned).toEqual([{ parentTaskId: "parent", worktree: false, vendor: "codex" }])
    expect(s.steps).toEqual(["select kid tabs=false", "enter kid"])
  })

  test("a native fork's first tab is written before the child is shown", async () => {
    const s = stub()
    const tabs = forkFirstTab("claude", "claude", "src-session")
    await runSpawnChild(s.orch, { parentTaskId: "parent", vendor: "claude", tabs }, s.hooks)

    expect(s.steps[0]).toBe("select kid tabs=true")
    expect(tabsByTask.get("kid")?.tabs[0]).toMatchObject({ id: "tab-1", forkFrom: "src-session", vendor: "claude" })
  })

  test("a refused spawn is reported and nothing is selected", async () => {
    const s = stub(new Error("REMOTE_PARENT_UNSUPPORTED: lives on a remote project"))
    const id = await runSpawnChild(s.orch, { parentTaskId: "parent", vendor: "claude" }, s.hooks)

    expect(id).toBeUndefined()
    expect(s.steps).toEqual([])
    expect(s.errors).toHaveLength(1)
    expect(s.errors[0]).toContain("lives on a remote project")
  })
})
