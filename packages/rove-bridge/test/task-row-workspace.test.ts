import { expect, test } from "bun:test"
import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import { taskRows } from "../src/task-rows.ts"

test.each([
  [undefined, true],
  ["git-worktree", true],
  ["cow-clone", true],
  ["layerfs", false],
  ["borrowed", false],
] as const)("exposes host branch ownership for backend %s", (backend, owns) => {
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
  expect(row?.ownsBranch).toBe(owns)
})
