import { serializeTask } from "@sma1lboy/rove-daemon/daemon/serialize-task"
import { describe, expect, it } from "vitest"
import type { Task } from "../../src/types/task.ts"
import { toTaskId } from "../../src/types/task.ts"

describe("task wire title", () => {
  it("an empty title serializes with a display fallback — no consumer can render blank", () => {
    const scratch: Task = {
      id: toTaskId("s1"),
      title: "",
      repo: "/Users/me",
      branch: "",
      worktreePath: "/Users/me",
      kind: "dir",
      scratch: true,
      status: "backlog",
      createdAt: "2026-08-16T00:00:00.000Z",
      updatedAt: "2026-08-16T00:00:00.000Z",
    }
    expect(serializeTask(scratch).title).toBe("/Users/me")
    // Pathless too: never an empty string on the wire.
    expect(serializeTask({ ...scratch, repo: "", worktreePath: "" }).title).toBe("scratch")
  })
})
