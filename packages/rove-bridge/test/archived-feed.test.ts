import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import type { RoveDaemonClient } from "@sma1lboy/rove-daemon/client"
import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import { defaultApiRuntime } from "@sma1lboy/rove/src/cli/api/runtime.ts"
import * as bridgeApi from "../src/ops/api.ts"
import type { BridgeApi } from "../src/ops/types.ts"
import { createRoveOps } from "../src/rove-ops.ts"

function task(id: string, extra: Partial<SerializedTask> = {}): SerializedTask {
  return {
    id,
    title: id,
    repo: "/work/app",
    branch: `b/${id}`,
    worktreePath: `/work/.rove/worktrees/${id}`,
    kind: "task",
    status: "in_progress",
    pinned: false,
    createdAt: "2026-10-21T00:00:00.000Z",
    updatedAt: "2026-10-21T00:00:00.000Z",
    ...extra,
  } as SerializedTask
}

describe("archived tasks in the feed", () => {
  beforeEach(() => {
    spyOn(defaultApiRuntime, "liveTaskIds").mockResolvedValue(null)
    spyOn(bridgeApi, "createBridgeApi").mockReturnValue({ verb: async () => ({ engines: [] }) } as unknown as BridgeApi)
  })
  afterEach(() => mock.restore())

  const signals = (remote: SerializedTask[]) => ({
    changes: () => null,
    tokens: () => new Map(),
    gates: () => [],
    remote: () => remote,
  })

  test("leave `tasks` (so every client hides them) and travel in `archived`, local and remote alike", async () => {
    const local = [task("main", { kind: "main" }), task("live"), task("gone", { archived: true })]
    const client = {
      request: async (name: string) => (name === "task.list" ? { tasks: local } : { items: [] }),
    } as unknown as RoveDaemonClient
    const far = task("far", { archived: true, origin: { machineId: "mac", hostLabel: "mac" } } as never)
    const payload = await createRoveOps(client, signals([far])).tasks()
    expect(payload.tasks.map((r) => r.id).sort()).toEqual(["live", "main"])
    expect(payload.archived?.map((r) => r.id)).toEqual(["gone", "far"])
    expect(payload.archived?.find((r) => r.id === "far")?.machine?.id).toBe("mac")
  })

  test("no archived rows means no `archived` field", async () => {
    const client = {
      request: async (name: string) => (name === "task.list" ? { tasks: [task("live")] } : { items: [] }),
    } as unknown as RoveDaemonClient
    const payload = await createRoveOps(client, signals([])).tasks()
    expect(payload.archived).toBeUndefined()
  })
})
