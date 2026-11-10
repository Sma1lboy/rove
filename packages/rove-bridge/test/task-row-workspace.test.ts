import { expect, test } from "bun:test"
import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import { taskRows } from "../src/task-rows.ts"

test.each([undefined, "git-worktree", "cow-clone", "layerfs", "borrowed"] as const)(
  "exposes host branch ownership for backend %s",
  (backend) => {
    const source = {
      id: "task",
      title: "Task",
      repo: "/w/app",
      kind: "task",
      branch: "feat/task",
      status: "in_progress",
      pinned: false,
      worktreePath: "/w/task",
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      ...(backend ? { workspace: { backend } } : {}),
    } as SerializedTask
    const [row] = taskRows([source], null, [], Date.now())
    expect(row?.ownsBranch).toBe(backend !== "layerfs" && backend !== "borrowed")
  },
)
