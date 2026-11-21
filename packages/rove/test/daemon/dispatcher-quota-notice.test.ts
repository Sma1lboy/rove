/**
 * A dispatched worker stopped by its engine's usage or billing limit tells
 * its dispatcher once, saying whether Rove resumes it and when.
 */

import { DaemonActivityRegistry } from "@sma1lboy/rove-daemon/daemon/activity-registry"
import { DaemonEventBus } from "@sma1lboy/rove-daemon/daemon/event-bus"
import type { DaemonHandlerContext } from "@sma1lboy/rove-daemon/daemon/server"
import { describe, expect, it, vi } from "vitest"
import { daemonRuntime } from "../../src/core/daemon-runtime.ts"
import { dispatch, fakeCtx } from "./handler-test-context.ts"

const RESUME_AT = "2099-01-05T15:14:00.000Z"

function harness(opts: { resetsAt?: number } = {}) {
  const worker: Record<string, unknown> = {
    id: "w1",
    title: "fix login",
    branch: "auth/login-fix",
    worktreePath: "/repo/.rove/worktrees/w1",
    vendor: "claude",
    dispatcher: { taskId: "m1", tabId: "tab-2" },
  }
  const seat = { id: "m1", worktreePath: "/repo", vendor: "claude" }
  const tasks: Record<string, Record<string, unknown>> = { w1: worker, m1: seat }
  const { ctx: base } = fakeCtx({
    listTasks: () => Object.values(tasks),
    getTask: (id: string) => tasks[id],
    setQuotaResume: async (id: string, value: unknown) => {
      if (value) tasks[id] = { ...tasks[id], quotaResume: value }
      else tasks[id] = { ...tasks[id], quotaResume: undefined }
    },
  })
  const pasted: Array<{ id: string; tabId: string; text: string }> = []
  const runtime = Object.assign(Object.create(daemonRuntime), {
    deliverPromptToLiveEngineTabDetailed: async (t: { id: string; tabId: string }, text: string) => {
      pasted.push({ id: t.id, tabId: t.tabId, text })
      return { outcome: "delivered", tabId: t.tabId }
    },
  })
  const activity = new DaemonActivityRegistry(new DaemonEventBus())
  const usage = opts.resetsAt ? { windows: [{ percent: 100, resetsAt: opts.resetsAt }] } : null
  const ctx = {
    ...base,
    runtime,
    activity,
    quotaUsage: { ...base.quotaUsage, get: async () => usage },
  } as unknown as DaemonHandlerContext
  const fail = (taskId: string, tabId: string, failure: string) =>
    dispatch("engine.reportEvent", { kind: "turn-failed", taskId, tabId, detail: { failure } }, ctx)
  return { ctx, pasted, activity, fail }
}

describe("a dispatched worker hitting its engine's limit", () => {
  it("tells the dispatcher's tab when Rove resumes it, once per wall", async () => {
    const h = harness({ resetsAt: Date.parse(RESUME_AT) })
    await h.fail("w1", "tab-1", "rate_limit")
    await h.fail("w1", "tab-1", "rate_limit")
    await vi.waitFor(() => expect(h.pasted.length).toBeGreaterThan(0))
    expect(h.pasted).toEqual([
      {
        id: "m1",
        tabId: "tab-2",
        text: '[ROVE WORKER] "fix login" (task w1, branch auth/login-fix) hit its usage limit; Rove resumes it automatically at 2099-01-05 15:14 UTC.',
      },
    ])
  })

  it("says a billing stop needs a human", async () => {
    const h = harness()
    await h.fail("w1", "tab-1", "billing")
    await vi.waitFor(() => expect(h.pasted).toHaveLength(1))
    expect(h.pasted[0]?.text).toContain("billing error; it needs a human")
  })

  it("stays quiet while the dispatcher itself is on the same wall", async () => {
    const h = harness()
    await h.fail("m1", "tab-2", "rate_limit")
    await h.fail("w1", "tab-1", "rate_limit")
    await new Promise((resolve) => setImmediate(resolve))
    expect(h.activity.stateOf("w1", "tab-1")).toBe("rate_limited")
    expect(h.pasted).toEqual([])
  })
})
