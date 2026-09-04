/**
 * `runAgainTask` (`workspace/quick-fork.ts`) — the row menu's "Run again"
 * create path, driven against a stub orchestrator.
 *
 * Three properties fail SILENTLY if they break, which is why each is asserted
 * on what came out rather than on the call completing:
 *
 *  - The brief must reach the child VERBATIM. A re-run whose prompt lost its
 *    blank lines looks completely successful and runs something the user never
 *    wrote — the whole reason this path bypasses the single-line composer.
 *  - The child must inherit the SOURCE's fork point and engine, not the
 *    defaults, or the "same run, clean worktree" promise quietly becomes
 *    "some other run".
 *  - A task with no stored brief must create NOTHING. The menu withholds the
 *    entry, so reaching here means a stale row, and creating an empty task
 *    would be worse than doing nothing.
 */

import { describe, expect, test } from "bun:test"
import { runAgainTask } from "../../src/tui-react/workspace/quick-fork"
import { type Task, toTaskId } from "../../src/types/task"

const BRIEF = "Print the third line of README.md and stop.\n\nDo not edit any file.\n"

function task(over: Partial<Task> = {}): Task {
  return {
    id: toTaskId("src"),
    title: "seed brief",
    repo: "/repos/rove",
    branch: "feat/seed",
    worktreePath: "/wt/seed",
    kind: "task",
    status: "in_progress",
    vendor: "claude",
    baseRef: "release/2",
    prompt: BRIEF,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...over,
  }
}

/** Records what the flow asked the orchestrator to do. */
function stub() {
  const created: Array<{ repo: string; baseRef: string; vendor: string }> = []
  const prompts: Array<{ id: string; prompt: string }> = []
  const errors: string[] = []
  const entered: string[] = []
  return {
    created,
    prompts,
    errors,
    entered,
    orch: {
      async createTask(input: { repo: string; baseRef: string; vendor: string }) {
        created.push(input)
        return task({ id: toTaskId("child"), branch: "new-task", worktreePath: "/wt/child" })
      },
      async setPrompt(id: string, prompt: string) {
        prompts.push({ id, prompt })
      },
    },
    hooks: {
      selectTask: () => {},
      enterTask: async (id: string) => {
        entered.push(id)
      },
      notifyError: (m: string) => errors.push(m),
    },
  }
}

describe("runAgainTask", () => {
  test("hands the child the source's brief byte for byte", async () => {
    const s = stub()
    // biome-ignore lint/suspicious/noExplicitAny: structural stub for the two-method orchestrator port.
    const id = await runAgainTask(s.orch as any, task(), s.hooks)

    expect(id).toBe("child")
    expect(s.prompts).toEqual([{ id: "child", prompt: BRIEF }])
    // The blank line and the trailing newline are the halves a flattening
    // composer would have eaten.
    expect(s.prompts[0]?.prompt).toContain("\n\n")
    expect(s.prompts[0]?.prompt.endsWith("\n")).toBe(true)
    expect(s.errors).toEqual([])
  })

  test("the child forks from the SOURCE's base ref and engine, not the defaults", async () => {
    const s = stub()
    // biome-ignore lint/suspicious/noExplicitAny: structural stub.
    await runAgainTask(s.orch as any, task({ baseRef: "release/2", vendor: "codex" }), s.hooks)
    expect(s.created).toEqual([{ repo: "/repos/rove", baseRef: "release/2", vendor: "codex" }])
    // And the new task is entered, so the brief's delivery mount actually runs.
    expect(s.entered).toEqual(["child"])
  })

  test("a task with no stored brief creates nothing at all", async () => {
    const s = stub()
    // biome-ignore lint/suspicious/noExplicitAny: structural stub.
    const id = await runAgainTask(s.orch as any, task({ prompt: undefined }), s.hooks)
    expect(id).toBeUndefined()
    expect(s.created).toEqual([])
    expect(s.prompts).toEqual([])
  })

  test("a failed persist still returns the created task rather than erroring", async () => {
    // The brief is already on its way to the tab by then; turning a created
    // task into a failure would strand a worktree the user can see.
    const s = stub()
    const orch = { ...s.orch, setPrompt: async () => Promise.reject(new Error("daemon gone")) }
    // biome-ignore lint/suspicious/noExplicitAny: structural stub.
    const id = await runAgainTask(orch as any, task(), s.hooks)
    expect(id).toBe("child")
    expect(s.errors).toEqual([])
  })

  test("a failed create reports through notifyError and persists no brief", async () => {
    const s = stub()
    const orch = { ...s.orch, createTask: async () => Promise.reject(new Error("worktree busy")) }
    // biome-ignore lint/suspicious/noExplicitAny: structural stub.
    const id = await runAgainTask(orch as any, task(), s.hooks)
    expect(id).toBeUndefined()
    expect(s.prompts).toEqual([])
    expect(s.errors.length).toBe(1)
    expect(s.errors[0]).toContain("worktree busy")
  })
})
