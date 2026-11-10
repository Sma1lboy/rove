import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import type { RoveDaemonClient } from "@sma1lboy/rove-daemon/client"
import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import { defaultApiRuntime } from "@sma1lboy/rove/src/cli/api/runtime.ts"
import * as bridgeApi from "../src/ops/api.ts"
import type { BridgeApi } from "../src/ops/types.ts"
import { createRoveOps } from "../src/rove-ops.ts"

const far = {
  id: "FAR",
  title: "on the mac",
  repo: "/Users/me/app",
  branch: "fix/x",
  worktreePath: "/Users/me/.rove/worktrees/app/fix-x",
  kind: "task",
  status: "in_progress",
  pinned: false,
  createdAt: "2026-10-21T00:00:00.000Z",
  updatedAt: "2026-10-21T00:00:00.000Z",
  origin: { machineId: "mac", hostLabel: "mac" },
} as unknown as SerializedTask

describe("a task on another machine in the feed", () => {
  beforeEach(() => {
    spyOn(defaultApiRuntime, "liveTaskIds").mockResolvedValue(null)
    spyOn(bridgeApi, "createBridgeApi").mockReturnValue({ verb: async () => ({ engines: [] }) } as unknown as BridgeApi)
  })
  afterEach(() => mock.restore())

  const client = {
    request: async (name: string) => (name === "task.list" ? { tasks: [] } : { items: [] }),
  } as unknown as RoveDaemonClient
  const base = { changes: () => null, tokens: () => new Map(), gates: () => [], remote: () => [far] }

  test("carries what its machine pushes: engine state and worktree changes", async () => {
    const ops = createRoveOps(client, {
      ...base,
      remoteLive: () => ({
        activity: new Map([["FAR", { state: "running", at: Date.now() }]]),
        changes: new Map([[far.worktreePath ?? "", { added: 3, deleted: 1, files: 2 }]]) as never,
        tokens: new Map(),
      }),
    })
    const [row] = (await ops.tasks()).tasks
    expect(row?.id).toBe("FAR")
    expect(row?.machine?.id).toBe("mac")
    expect(row?.activity?.state).toBe("running")
    expect(row?.changes).toMatchObject({ added: 3, deleted: 1 })
  })

  test("without pushed readings it stays unknown rather than idle", async () => {
    const [row] = (await createRoveOps(client, base).tasks()).tasks
    expect(row?.activity?.state).not.toBe("running")
    expect(row?.changes).toBeUndefined()
  })
})
