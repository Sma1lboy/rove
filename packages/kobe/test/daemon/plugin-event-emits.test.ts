/**
 * The new plugin-event emit sites, each asserted from its real entry point:
 * the RPC handlers (`note.filed`, `message.delivered`, `attention.handled`),
 * the automation runner (`automation.*`), and the quota-resume scheduler
 * (`quota.exhausted` / `quota.resumed`). Event NAME + detail shape are the
 * contract plugins subscribe against.
 */

import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runAutomationOnce, sweepAutomations } from "@sma1lboy/kobe-daemon/daemon/automation-runner"
import { AutomationsStore } from "@sma1lboy/kobe-daemon/daemon/automations-store"
import { DeferredPromptsStore } from "@sma1lboy/kobe-daemon/daemon/deferred-prompts-store"
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

const TASK = { id: "t1", repo: "/repo", title: "Task One" }

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
  async function deps(overrides: Record<string, unknown> = {}) {
    const seen: Report[] = []
    const directory = mkdtempSync(join(tmpdir(), "rove-routine-events-"))
    const store = new AutomationsStore(join(directory, "automations.json"), () => 0)
    await store.init()
    const automation = await store.create({
      name: "audit",
      repo: process.cwd(),
      prompt: "p",
      schedule: "0 9 * * *",
      missedRunGraceMinutes: 30,
    })
    return {
      seen,
      automation,
      directory,
      deps: {
        store,
        orch: { createTask: async () => ({ id: "task-9" }) },
        runtime: { startTaskSessionWithPrompt: async () => ({ started: true }) },
        link: (() => ({})) as never,
        plugins: () => ({ handleUiReport: (r: Report) => seen.push(r) }),
        ...overrides,
      },
    }
  }

  it("a dispatched run fires automation.dispatched with the run detail", async () => {
    const { seen, automation, deps: d } = await deps()
    await runAutomationOnce(d as never, automation as never, { scheduledFor: 60_000, trigger: "manual" })
    expect(seen).toEqual([
      {
        kind: "automation.dispatched",
        taskId: "task-9",
        detail: {
          automationId: automation.id,
          name: "audit",
          repo: automation.repo,
          status: "dispatched",
          trigger: "manual",
          scheduledFor: new Date(60_000).toISOString(),
        },
      },
    ])
  })

  it("a failed engine start fires automation.failed", async () => {
    const {
      seen,
      automation,
      deps: d,
    } = await deps({ runtime: { startTaskSessionWithPrompt: async () => ({ started: false }) } })
    await runAutomationOnce(d as never, automation as never, { scheduledFor: 0, trigger: "manual" })
    expect(seen[0]).toMatchObject({
      kind: "automation.failed",
      taskId: "task-9",
      detail: { status: "dispatch_failed", error: "engine session did not start" },
    })
  })

  it("a queued run emits only automation.skipped with its receipt and target", async () => {
    const f = await deps()
    const target = { kind: "existing-tab", taskId: "task-9", tabId: "tab-2" } as const
    const bound = await f.deps.store.update(f.automation.id, { target })
    const deferred = new DeferredPromptsStore(join(f.directory, "deferred.json"))
    await runAutomationOnce(
      {
        ...f.deps,
        deferred,
        orch: { getTask: () => ({ id: target.taskId, repo: bound!.repo, worktreePath: bound!.repo }) },
        runtime: {
          deliverPromptToLiveEngineTabDetailed: async () => ({
            outcome: "busy",
            tabId: target.tabId,
            layer: "composer-not-empty",
          }),
        },
        inbox: { recordPromptDeferred: async () => {} },
      } as never,
      bound!,
      { scheduledFor: 60_000, trigger: "manual" },
    )
    const receipt = f.deps.store.runsFor(f.automation.id)[0]
    expect(f.seen).toEqual([
      {
        kind: "automation.skipped",
        taskId: target.taskId,
        detail: {
          automationId: bound!.id,
          name: bound!.name,
          repo: bound!.repo,
          status: "deferred",
          trigger: "manual",
          scheduledFor: new Date(60_000).toISOString(),
          tabId: target.tabId,
          deferredId: receipt?.deferredId,
        },
      },
    ])
    expect((await deferred.list()).records[0]?.id).toBe(receipt?.deferredId)
  })

  it("a missed occurrence fires automation.skipped", async () => {
    const { seen, automation, deps: d } = await deps()
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
