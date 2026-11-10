import { describe, expect, it } from "vitest"
import { movePartition } from "../../src/orchestrator/move-partition.ts"
import type { Task } from "../../src/types/task.ts"

const task = (id: string, extra: object = {}): Task => ({ id, repo: "/repo", kind: "task", ...extra }) as Task

describe("movePartition", () => {
  it("leaves out tasks no list shows beside the moved one", () => {
    const b = task("b")
    const tasks = [
      task("a"),
      task("archived", { archived: true }),
      task("checkout", { worktreeOnly: true, parentTaskId: "a" }),
      b,
    ]
    expect(movePartition(tasks, b)).toEqual(["a", "b"])
  })
})
