/**
 * A quick-fork from a managed task asks for a clone of its worktree (uncommitted work included). When the daemon
 * refuses (`FORK_UNSUPPORTED`) the user must still get a task, started the old way, and be told what stayed behind.
 */

import { type QuickForkOrchestrator, runQuickFork } from "@/tui-react/workspace/quick-fork"
import type { Task } from "@/types/task"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/state/repos", () => ({ addSavedRepo: () => {} }))
vi.mock("@/state/vendor-prefs", () => ({ setRepoLastActiveVendor: () => {} }))

function harness(createTask: (input: Record<string, unknown>) => Promise<Task>) {
  const created: Array<Record<string, unknown>> = []
  const notices: string[] = []
  const errors: string[] = []
  const orch = {
    createTask: async (input: Record<string, unknown>) => {
      created.push(input)
      return createTask(input)
    },
  } as unknown as QuickForkOrchestrator
  const hooks = {
    selectTask: () => {},
    enterTask: async () => {},
    notifyError: (m: string) => void errors.push(m),
    notify: (m: string) => void notices.push(m),
  }
  return { orch, hooks, created, notices, errors }
}

const result = { baseRef: "feat/x", vendor: "claude" as const, forkFrom: "PARENT" }

describe("quick-fork with a clone", () => {
  it("creates the clone and says nothing when the daemon allows it", async () => {
    const h = harness(async () => ({ id: "CHILD" }) as Task)
    expect(await runQuickFork(h.orch, "/repo", result, h.hooks)).toBe("CHILD")
    expect(h.created).toHaveLength(1)
    expect(h.created[0]?.forkFrom).toBe("PARENT")
    expect(h.notices).toEqual([])
  })

  it("falls back to a plain new task and names why the uncommitted work stayed behind", async () => {
    const h = harness(async (input) => {
      if (input.forkFrom) throw new Error("FORK_UNSUPPORTED: the volume cannot clone files")
      return { id: "PLAIN" } as Task
    })
    expect(await runQuickFork(h.orch, "/repo", result, h.hooks)).toBe("PLAIN")
    expect(h.created.map((c) => c.forkFrom)).toEqual(["PARENT", undefined])
    expect(h.notices).toHaveLength(1)
    expect(h.notices[0]).toContain("the volume cannot clone files")
    expect(h.errors).toEqual([])
  })

  it("does not paper over any other failure with a plain task", async () => {
    const h = harness(async () => {
      throw new Error("RPC_ERROR: daemon went away")
    })
    expect(await runQuickFork(h.orch, "/repo", result, h.hooks)).toBeUndefined()
    expect(h.created).toHaveLength(1)
    expect(h.errors).toHaveLength(1)
  })
})
