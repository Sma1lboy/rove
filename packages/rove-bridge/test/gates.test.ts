import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import type { RoveDaemonClient } from "@sma1lboy/rove-daemon/client"
import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import { defaultApiRuntime } from "@sma1lboy/rove/src/cli/api/runtime.ts"
import type { ActiveGate } from "@sma1lboy/rove/src/client/remote-orchestrator.ts"
import { dismissHitsOnlyGates, gateRows } from "../src/gates.ts"
import * as bridgeApi from "../src/ops/api.ts"
import type { BridgeApi } from "../src/ops/types.ts"
import type { AttentionRow } from "../src/protocol.ts"
import { attentionRows, createRoveOps } from "../src/rove-ops.ts"

function gate(over: Partial<ActiveGate> & { id: string }): ActiveGate {
  return {
    taskId: "T1",
    tabId: null,
    question: "Which approach?",
    options: [],
    status: "open",
    createdAt: "2026-10-12T10:00:00.000Z",
    ...over,
  }
}

const tasks = [{ id: "T1", title: "Nightly loop" }] as SerializedTask[]

describe("gate rows", () => {
  test("carry the whole question, options, recommendation and the task's title", () => {
    const [row] = gateRows(
      [
        gate({
          id: "g-3",
          tabId: "tab-2",
          options: [
            { key: "a", label: "Rewrite", detail: "2 days" },
            { key: "b", label: "Patch" },
          ],
          recommended: "b",
          context: "a is risky",
        }),
      ],
      tasks,
    )
    expect(row).toEqual({
      id: "g-3",
      taskId: "T1",
      tabId: "tab-2",
      question: "Which approach?",
      options: [
        { key: "a", label: "Rewrite", detail: "2 days" },
        { key: "b", label: "Patch" },
      ],
      recommended: "b",
      context: "a is risky",
      status: "open",
      createdAt: "2026-10-12T10:00:00.000Z",
      label: "Nightly loop",
    })
  })

  test("open gates and answered-but-undelivered ones show; delivered and withdrawn do not", () => {
    const rows = gateRows(
      [
        gate({ id: "g-1" }),
        gate({ id: "g-2", status: "answered", handoff: "undelivered" }),
        gate({ id: "g-3", status: "answered", handoff: "delivered" }),
        gate({ id: "g-4", status: "withdrawn" }),
      ],
      tasks,
    )
    expect(rows.map((r) => [r.id, r.status, r.handoff])).toEqual([
      ["g-1", "open", undefined],
      ["g-2", "answered", "undelivered"],
    ])
  })

  test("oldest first, ids ordered numerically; a task the list lost falls back to its id", () => {
    const rows = gateRows(
      [
        gate({ id: "g-10", createdAt: "2026-10-12T10:00:00.000Z" }),
        gate({ id: "g-9", createdAt: "2026-10-12T10:00:00.000Z" }),
        gate({ id: "g-8", taskId: "gone", createdAt: "2026-10-12T09:00:00.000Z" }),
      ],
      tasks,
    )
    expect(rows.map((r) => [r.id, r.label])).toEqual([
      ["g-8", "gone"],
      ["g-9", "Nightly loop"],
      ["g-10", "Nightly loop"],
    ])
  })
})

describe("the tasks payload", () => {
  // `tasks()` also reads the machine: live tabs from its PTY host and an engine scan that probes every
  // installed CLI. Neither is what these tests pin, and both hang or throw depending on the host.
  beforeEach(() => {
    spyOn(defaultApiRuntime, "liveTaskIds").mockResolvedValue(null)
    spyOn(bridgeApi, "createBridgeApi").mockReturnValue({
      verb: async () => ({ engines: [] }),
    } as unknown as BridgeApi)
  })
  afterEach(() => mock.restore())

  test("carries the gates signal next to tasks and attention", async () => {
    const client = {
      request: async (name: string) => {
        if (name === "task.list") return { tasks }
        if (name === "attention.list")
          return {
            items: [
              {
                taskId: "T1",
                tabId: null,
                state: "decision_needed",
                unread: true,
                at: 5,
                detail: { gate: { id: "g-7", question: "Which approach?", options: [] } },
              },
            ],
          }
        throw new Error("not served")
      },
    } as unknown as RoveDaemonClient
    const ops = createRoveOps(client, {
      changes: () => null,
      tokens: () => new Map(),
      gates: () => [gate({ id: "g-7" })],
    })
    const payload = await ops.tasks()
    expect(payload.gates.map((g) => g.id)).toEqual(["g-7"])
    expect(payload.attention).toEqual([
      { taskId: "T1", tabId: null, state: "decision_needed", unread: true, at: 5, gateId: "g-7" },
    ])
  })

  test("without live signals the gate list is empty, not absent", async () => {
    const client = { request: async () => ({ tasks: [], items: [] }) } as unknown as RoveDaemonClient
    expect((await createRoveOps(client).tasks()).gates).toEqual([])
  })
})

describe("attention rows", () => {
  test("only a decision_needed row names its gate", () => {
    const rows = attentionRows(
      [
        { taskId: "T1", tabId: null, state: "decision_needed", unread: true, at: 1, detail: { gate: { id: "g-1" } } },
        { taskId: "T1", tabId: null, state: "turn_complete", unread: true, at: 2 },
      ] as never,
      [],
    )
    expect(rows[0]).toMatchObject({ gateId: "g-1" })
    expect(rows[1]).not.toHaveProperty("gateId")
  })
})

describe("legacy dismiss guard", () => {
  const row = (state: string, tabId: string | null = "tab-1"): AttentionRow => ({
    taskId: "T1",
    tabId,
    state,
    unread: true,
    at: 1,
  })

  test("a tab holding only decision rows is a gate tap", () => {
    expect(dismissHitsOnlyGates([row("decision_needed")], "T1", "tab-1")).toBe(true)
    expect(dismissHitsOnlyGates([row("decision_needed", null)], "T1", undefined)).toBe(true)
  })

  test("a tab with any other episode, or no row at all, is left to the daemon", () => {
    expect(dismissHitsOnlyGates([row("decision_needed"), row("turn_complete")], "T1", "tab-1")).toBe(false)
    expect(dismissHitsOnlyGates([row("decision_needed")], "T1", "tab-2")).toBe(false)
    expect(dismissHitsOnlyGates([], "T1", "tab-1")).toBe(false)
  })
})
