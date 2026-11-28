import { movePartition } from "@sma1lboy/rove-core/orchestrator/move-partition.ts"
import type { Task } from "@sma1lboy/rove-core/types/task.ts"
import { describe, expect, it } from "vitest"

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
