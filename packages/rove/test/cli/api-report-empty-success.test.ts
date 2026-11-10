/**
 * `report --outcome done` on a `send` delivery is the worker's success claim,
 * so it gets the same zero-commit refusal as a `succeeded:` send.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { invokeVerb } from "../../src/cli/api-cmd.ts"
import { resetVerifiedSelfSession, verifiedSelfSession } from "../../src/cli/api/dispatcher.ts"
import { FakeClient, expectApiError, stubRuntime, taskFixture } from "./api-handler-fixtures.ts"

const saved = { task: process.env.ROVE_TASK_ID, tab: process.env.ROVE_TAB_ID }

function client(): FakeClient {
  return new FakeClient({
    "task.get": () => ({ task: taskFixture({ id: "worker-1", branch: "fix/thing", kind: "task" }) }),
    "delivery.list": () => ({ deliveries: [{ id: "d-7", source: "send" }] }),
    "delivery.report": () => ({ delivery: { id: "d-7" } }),
  })
}

const branchAhead = (ahead: number) => ({
  readBranchSignals: async () => ({ baseRef: "origin/main", ahead, behind: null, diff: null }),
})

const ARGS = ["--delivery", "d-7", "--outcome", "done", "--summary", "fixed"]

beforeEach(async () => {
  resetVerifiedSelfSession()
  process.env.ROVE_TASK_ID = "worker-1"
  process.env.ROVE_TAB_ID = "tab-1"
  await verifiedSelfSession(
    { ROVE_TASK_ID: "worker-1", ROVE_TAB_ID: "tab-1" },
    {
      sessions: async () => [{ key: "worker-1::tab-1", pid: 100, alive: true }],
      ps: async () => "  100     1 /bin/zsh -il\n  500   100 bun rove api report",
      pid: 500,
    },
  )
})

afterEach(() => {
  resetVerifiedSelfSession()
  for (const [k, v] of [
    ["ROVE_TASK_ID", saved.task],
    ["ROVE_TAB_ID", saved.tab],
  ] as const) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

describe("report --outcome done on a send delivery", () => {
  it("is refused with EMPTY_SUCCESS_REPORT from a branch with 0 commits, and accepted once there is a commit", async () => {
    const empty = client()
    await expectApiError(
      () => invokeVerb("report", ARGS, { client: empty, runtime: stubRuntime(branchAhead(0)) }),
      "EMPTY_SUCCESS_REPORT",
      /fix\/thing has 0 commits/,
    )
    expect(empty.requests.some((r) => r.name === "delivery.report")).toBe(false)

    const committed = client()
    await invokeVerb("report", ARGS, { client: committed, runtime: stubRuntime(branchAhead(1)) })
    expect(committed.requests.some((r) => r.name === "delivery.report")).toBe(true)
  })
})
