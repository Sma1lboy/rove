/**
 * A report on a dispatched worker's delivery reaches the dispatcher as one
 * plain line, so the worker sends no separate `succeeded:` message.
 */

import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { AttentionInboxStore } from "../../../rove-daemon/src/daemon/attention-inbox.ts"
import { DeliveriesStore } from "../../../rove-daemon/src/daemon/deliveries-store.ts"
import { DaemonEventBus } from "../../../rove-daemon/src/daemon/event-bus.ts"
import {
  type DaemonHandlerContext,
  createDaemonHandlerRegistry,
  dispatchDaemonRequest,
} from "../../../rove-daemon/src/daemon/handlers.ts"

const WORKER = { id: "w1", title: "fix login", branch: "auth/login-fix", dispatcher: { taskId: "m1", tabId: "tab-2" } }
const SEAT = { id: "m1", kind: "main", worktreePath: "/repo", vendor: "claude" }

async function harness(seatTabKind?: string) {
  const dir = mkdtempSync(join(tmpdir(), "rove-report-notice-"))
  const inbox = new AttentionInboxStore(join(dir, "inbox.json"), new DaemonEventBus())
  await inbox.init()
  const deliveries = new DeliveriesStore(join(dir, "deliveries.json"))
  await deliveries.init()
  const pasted: Array<{ id: string; tabId: string; text: string }> = []
  const tasks: Record<string, unknown> = { w1: WORKER, m1: SEAT }
  const ctx = {
    deliveries,
    inbox,
    orch: { getTask: (id: string) => tasks[id], listTasks: () => [WORKER, SEAT], setWorkerReport: async () => {} },
    activity: { stateOf: () => "running" },
    rowStatus: { list: () => ({ tasks: { m1: { tabs: seatTabKind ? { "tab-2": { kind: seatTabKind } } : {} } } }) },
    runtime: {
      deliverPromptToLiveEngineTabDetailed: async (t: { id: string; tabId: string }, text: string) => {
        pasted.push({ id: t.id, tabId: t.tabId, text })
        return { outcome: "delivered", tabId: t.tabId }
      },
    },
  } as unknown as DaemonHandlerContext
  const registry = createDaemonHandlerRegistry()
  const delivery = await deliveries.arm({ taskId: "w1", tabId: "tab-1", source: "send", promptHead: "fix it" })
  const report = () =>
    dispatchDaemonRequest(
      registry,
      "delivery.report",
      { deliveryId: delivery.id, outcome: "done", summary: "login fixed\nlong detail", evidence: ["abc123"] },
      ctx,
    )
  return { pasted, report }
}

describe("delivery.report on a dispatched worker", () => {
  it("pastes one line with the outcome into the dispatcher's tab, asking nothing back", async () => {
    const h = await harness()
    await h.report()
    expect(h.pasted).toEqual([
      {
        id: "m1",
        tabId: "tab-2",
        text: '[ROVE REPORT] "fix login" (task w1, branch auth/login-fix) done: login fixed',
      },
    ])
  })

  it("pastes nothing while the dispatcher's tab is at a menu", async () => {
    const h = await harness("needs-input")
    await h.report()
    expect(h.pasted).toEqual([])
  })
})
