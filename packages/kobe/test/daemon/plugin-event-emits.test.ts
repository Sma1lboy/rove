/**
 * The new plugin-event emit sites, each asserted from its real entry point:
 * the RPC handlers (`note.filed`, `message.delivered`, `attention.handled`),
 * the automation runner (`automation.*`), and the quota-resume scheduler
 * (`quota.exhausted` / `quota.resumed`). Event NAME + detail shape are the
 * contract plugins subscribe against.
 */

import { runAutomationOnce, sweepAutomations } from "@sma1lboy/kobe-daemon/daemon/automation-runner"
import type { AutomationsStore } from "@sma1lboy/kobe-daemon/daemon/automations-store"
import type { DaemonRequestName } from "@sma1lboy/kobe-daemon/daemon/protocol"
import { scheduleQuotaResume } from "@sma1lboy/kobe-daemon/daemon/quota-resume"
import type { QuotaUsageCache } from "@sma1lboy/kobe-daemon/daemon/quota-usage-cache"
import {
  type DaemonHandlerContext,
  createDaemonHandlerRegistry,
  dispatchDaemonRequest,
} from "@sma1lboy/kobe-daemon/daemon/server"
import { describe, expect, it } from "vitest"
import { fakeCtx } from "./handler-test-context.ts"

function dispatch(name: DaemonRequestName, payload: unknown, ctx: DaemonHandlerContext): Promise<unknown> {
  return dispatchDaemonRequest(createDaemonHandlerRegistry(), name, payload, ctx)
}

type Report = { kind: string; taskId?: string; detail?: Record<string, unknown> }

function withPluginSink(ctx: DaemonHandlerContext): Report[] {
  const seen: Report[] = []
  ;(ctx as { plugins?: unknown }).plugins = {
    handleEngineReport: () => {},
    handleUiReport: (r: Report) => seen.push(r),
  }
  return seen
}

const TASK = { id: "t1", repo: "/repo", title: "Task One", archived: false }

describe("handler emit sites", () => {
  it("note.file fires note.filed with truncated text + length", async () => {
    const long = "x".repeat(600)
    const { ctx } = fakeCtx({ getTask: () => TASK, listTasks: () => [TASK] })
    const seen = withPluginSink(ctx)
    await dispatch("note.file", { taskId: "t1", text: long }, ctx)
    expect(seen).toEqual([
      {
        kind: "note.filed",
        taskId: "t1",
        detail: {
          repo: "/repo",
          author: "Task One",
          text: `${"x".repeat(512)}…`,
          length: 600,
          routed: false,
          persisted: true,
        },
      },
    ])
  })

  it("session.deliver fires message.delivered with reach, not a delivery claim", async () => {
    const { ctx } = fakeCtx({ getTask: () => TASK })
    const seen = withPluginSink(ctx)
    await dispatch("session.deliver", { taskId: "t1", text: "hello", tabId: "tab-2" }, ctx)
    expect(seen).toEqual([
      {
        kind: "message.delivered",
        taskId: "t1",
        detail: { source: "dispatcher", tabId: "tab-2", length: 5, clients: 1 },
      },
    ])
  })

  it("attention.dismiss and attention.read both fire attention.handled", async () => {
    const { ctx } = fakeCtx()
    const seen = withPluginSink(ctx)
    await dispatch("attention.dismiss", { taskId: "t1", tabId: "tab-2" }, ctx)
    await dispatch("attention.read", { taskId: "t1", at: 42 }, ctx)
    expect(seen).toEqual([
      { kind: "attention.handled", taskId: "t1", detail: { how: "dismissed", tabId: "tab-2" } },
      { kind: "attention.handled", taskId: "t1", detail: { how: "read" } },
    ])
  })
})

describe("automation runner emit sites", () => {
  const automation = {
    id: "a1",
    name: "audit",
    repo: "/repo",
    prompt: "p",
    schedule: "0 9 * * *",
    enabled: true,
    createdAt: new Date(0).toISOString(),
    missedRunGraceMinutes: 30,
    nextRunAt: new Date(0).toISOString(),
  }

  function deps(overrides: Record<string, unknown> = {}) {
    const seen: Report[] = []
    const runs: unknown[] = []
    return {
      seen,
      runs,
      deps: {
        store: {
          recordRun: async (r: unknown) => void runs.push(r),
          list: () => [automation],
          advanceNextRun: async () => {},
        } as unknown as AutomationsStore,
        orch: { createTask: async () => ({ id: "task-9" }) },
        runtime: { startTaskSessionWithPrompt: async () => true },
        link: (() => ({})) as never,
        plugins: () => ({ handleUiReport: (r: Report) => seen.push(r) }),
        ...overrides,
      },
    }
  }

  it("a dispatched run fires automation.dispatched with the run detail", async () => {
    const { seen, deps: d } = deps()
    await runAutomationOnce(d as never, automation as never, { scheduledFor: 60_000, trigger: "manual" })
    expect(seen).toEqual([
      {
        kind: "automation.dispatched",
        taskId: "task-9",
        detail: {
          automationId: "a1",
          name: "audit",
          repo: "/repo",
          status: "dispatched",
          trigger: "manual",
          scheduledFor: new Date(60_000).toISOString(),
        },
      },
    ])
  })

  it("a failed engine start fires automation.failed", async () => {
    const { seen, deps: d } = deps({ runtime: { startTaskSessionWithPrompt: async () => false } })
    await runAutomationOnce(d as never, automation as never, { scheduledFor: 0, trigger: "manual" })
    expect(seen[0]).toMatchObject({
      kind: "automation.failed",
      taskId: "task-9",
      detail: { status: "dispatch_failed", error: "engine session did not start" },
    })
  })

  it("a missed occurrence fires automation.skipped", async () => {
    const { seen, deps: d } = deps()
    // now far past the grace window relative to the last cron occurrence
    await sweepAutomations({ ...(d as object), now: () => Date.parse("2026-01-10T12:00:00Z") } as never)
    expect(seen[0]).toMatchObject({ kind: "automation.skipped", detail: { status: "skipped_missed" } })
  })
})

describe("quota-resume emit sites", () => {
  it("arming fires quota.exhausted with vendor + resumeAt", async () => {
    const seen: Report[] = []
    const resetsAt = Date.now() + 60_000
    const orch = {
      getTask: () => ({ id: "t1", vendor: "claude", worktreePath: "/wt" }),
      setQuotaResume: async () => {},
    }
    const cache = {
      get: async () => ({ windows: [{ percent: 100, resetsAt }] }),
    } as unknown as QuotaUsageCache
    await scheduleQuotaResume(orch as never, { defaultTaskVendor: "claude" } as never, cache, "t1", Date.now, () => ({
      handleUiReport: (r: Report) => seen.push(r),
    }))
    expect(seen).toEqual([
      {
        kind: "quota.exhausted",
        taskId: "t1",
        detail: { vendor: "claude", resumeAt: new Date(resetsAt).toISOString() },
      },
    ])
  })
})
