/**
 * Should-run (docs/design/long-run-controls.md § 2): the verdict and its
 * precedence, the routine runner's `skipped_blocked`, `send.admit`'s
 * check-and-claim, and quota-resume declining a task the owner must look at.
 * Real deliveries/gates stores; the activity ledger and orchestrator are fakes.
 */

import { mkdtempSync } from "node:fs"
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { dispatchAutomation } from "../../../rove-daemon/src/daemon/automation-dispatch.ts"
import type { DispatchRunnability } from "../../../rove-daemon/src/daemon/automation-dispatch.ts"
import { runAutomationOnce } from "../../../rove-daemon/src/daemon/automation-runner.ts"
import { AutomationsStore } from "../../../rove-daemon/src/daemon/automations-store.ts"
import type { DaemonTask, EngineActivityDetail, TaskActivityState } from "../../../rove-daemon/src/daemon/contracts.ts"
import { DeliveriesStore } from "../../../rove-daemon/src/daemon/deliveries-store.ts"
import { GatesStore } from "../../../rove-daemon/src/daemon/gates-store.ts"
import {
  type DaemonHandlerContext,
  createDaemonHandlerRegistry,
  dispatchDaemonRequest,
} from "../../../rove-daemon/src/daemon/handlers.ts"
import { startQuotaResumeRunner } from "../../../rove-daemon/src/daemon/quota-resume.ts"
import type { RunnabilityVerdict, SkipVerdict } from "../../../rove-daemon/src/daemon/runnability-contracts.ts"
import {
  type RunnabilityDeps,
  createDispatchRunnability,
  evaluateRunnability,
} from "../../../rove-daemon/src/daemon/runnability.ts"
import type { DaemonRuntimeAdapter } from "../../../rove-daemon/src/daemon/runtime.ts"
import { NOW, REPO, automation, fakeDeps } from "./automation-runner-fixtures.ts"

const TASK_ID = "t1"
const TAB = "tab-1"
const UNTIL = new Date(NOW + 3_600_000).toISOString()

function task(overrides: Partial<DaemonTask> = {}): DaemonTask {
  return {
    id: TASK_ID,
    title: "Worker",
    repo: REPO,
    worktreePath: REPO,
    kind: "task",
    status: "in_progress",
    branch: "feat/x",
    createdAt: new Date(NOW).toISOString(),
    updatedAt: new Date(NOW).toISOString(),
    ...overrides,
  } satisfies DaemonTask
}

describe("should-run", () => {
  const dirs: string[] = []
  afterEach(async () => {
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
  })

  async function setup() {
    const dir = mkdtempSync(join(tmpdir(), "rove-runnability-"))
    dirs.push(dir)
    let clock = NOW
    const deliveries = new DeliveriesStore(join(dir, "deliveries.json"), () => clock)
    await deliveries.init()
    const gates = new GatesStore(join(dir, "gates.json"), () => new Date(clock))
    await gates.init()
    const state = {
      task: task() as DaemonTask | undefined,
      activity: new Map<string, { state: TaskActivityState; detail?: EngineActivityDetail }>(),
    }
    const deps: RunnabilityDeps = {
      orch: { getTask: () => state.task },
      activity: { entryOf: (_taskId, tabId) => state.activity.get(tabId ?? "*") },
      gates,
      deliveries,
      now: () => clock,
    }
    const verdict = (tab: string | null = TAB, ignore: Parameters<typeof evaluateRunnability>[3] = {}) =>
      evaluateRunnability(deps, TASK_ID, tab, ignore)
    const setActivity = (s: TaskActivityState, detail?: EngineActivityDetail, tab = TAB) =>
      state.activity.set(tab, { state: s, ...(detail ? { detail } : {}) })
    /** An armed delivery whose turn ended with no report. */
    const missingDelivery = async () => {
      const d = await deliveries.arm({ taskId: TASK_ID, tabId: TAB, source: "send", promptHead: "tick" })
      return (await deliveries.markMissing(d.id, "turn-complete"))!
    }
    return {
      deps,
      state,
      deliveries,
      gates,
      verdict,
      setActivity,
      missingDelivery,
      advance: (ms: number) => {
        clock += ms
      },
    }
  }

  describe("evaluateRunnability", () => {
    it("runs an idle task", async () => {
      const h = await setup()
      h.setActivity("idle")
      expect(h.verdict()).toEqual({ run: true })
    })

    it("a deleted or unknown task is task-missing", async () => {
      const h = await setup()
      h.state.task = undefined
      expect(h.verdict()).toMatchObject({ run: false, reason: "task-missing" })
    })

    it("an open gate beats quota, and names the gates", async () => {
      const h = await setup()
      h.state.task = task({ quotaResume: { resumeAt: UNTIL, requestedAt: new Date(NOW).toISOString() } })
      h.setActivity("rate_limited", { failure: "rate_limit" })
      const gate = await h.gates.raise({ taskId: TASK_ID, question: "Ship it?" })
      expect(h.verdict()).toEqual({ run: false, reason: "awaiting-owner", detail: "Ship it?", gateIds: [gate.id] })
    })

    it("an answered-but-undelivered gate alone is runnable: the next tick carries the answer", async () => {
      const h = await setup()
      h.setActivity("idle")
      const gate = await h.gates.raise({ taskId: TASK_ID, question: "Ship it?" })
      await h.gates.answer(gate.id, { text: "yes", by: "cli" })
      expect(h.gates.undeliveredFor(TASK_ID, null)).toHaveLength(1)
      expect(h.verdict()).toEqual({ run: true })
    })

    it("a withdrawn gate stops blocking", async () => {
      const h = await setup()
      const gate = await h.gates.raise({ taskId: TASK_ID, question: "Ship it?" })
      expect(h.verdict()).toMatchObject({ reason: "awaiting-owner" })
      await h.gates.withdraw(gate.id)
      expect(h.verdict()).toEqual({ run: true })
    })

    describe("report-missing", () => {
      it("blocks until the owner dismisses the row", async () => {
        const h = await setup()
        const missing = await h.missingDelivery()
        expect(h.verdict()).toMatchObject({ run: false, reason: "report-missing" })
        await h.deliveries.dismiss(missing.id)
        expect(h.verdict()).toEqual({ run: true })
      })

      it("a late report clears it", async () => {
        const h = await setup()
        const missing = await h.missingDelivery()
        await h.deliveries.setReport(missing.id, { outcome: "done", summary: "finished", evidence: [] })
        expect(h.verdict()).toEqual({ run: true })
      })

      it("a skipped tick in between does not hide it", async () => {
        const h = await setup()
        await h.missingDelivery()
        await h.deliveries.recordSkipped({
          taskId: TASK_ID,
          tabId: TAB,
          source: "send",
          promptHead: "tick",
          skipped: { run: false, reason: "report-missing" },
        })
        expect(h.verdict()).toMatchObject({ run: false, reason: "report-missing" })
      })

      it("only the newest delivery counts: a later reported one supersedes an old miss", async () => {
        const h = await setup()
        await h.missingDelivery()
        h.advance(1000)
        const next = await h.deliveries.arm({ taskId: TASK_ID, tabId: TAB, source: "send", promptHead: "tick 2" })
        await h.deliveries.setReport(next.id, { outcome: "done", summary: "ok", evidence: [] })
        expect(h.verdict()).toEqual({ run: true })
      })

      it("beats a quota block", async () => {
        const h = await setup()
        await h.missingDelivery()
        h.setActivity("rate_limited", { failure: "rate_limit" })
        expect(h.verdict()).toMatchObject({ reason: "report-missing" })
      })

      it("survives a dismissal being read back from disk", async () => {
        const h = await setup()
        const missing = await h.missingDelivery()
        await h.deliveries.dismiss(missing.id)
        const reloaded = new DeliveriesStore(join(dirs[0] as string, "deliveries.json"))
        await reloaded.init()
        expect(reloaded.get(missing.id)?.dismissedAt).toBeDefined()
      })
    })

    describe("quota", () => {
      it("blocks with the reset time, and clears itself at until", async () => {
        const h = await setup()
        h.state.task = task({ quotaResume: { resumeAt: UNTIL, requestedAt: new Date(NOW).toISOString() } })
        h.setActivity("rate_limited", { failure: "rate_limit" })
        expect(h.verdict()).toEqual({ run: false, reason: "quota", until: UNTIL })
        h.advance(3_600_000)
        expect(h.verdict()).toEqual({ run: true })
      })

      it("a rate limit with no known reset still blocks, without until", async () => {
        const h = await setup()
        h.setActivity("rate_limited", { failure: "rate_limit" })
        expect(h.verdict()).toEqual({ run: false, reason: "quota" })
      })

      it("billing rides the rate_limited badge but needs a human: engine-error", async () => {
        const h = await setup()
        h.setActivity("rate_limited", { failure: "billing", note: "credit balance too low" })
        expect(h.verdict()).toMatchObject({ run: false, reason: "engine-error", detail: "credit balance too low" })
      })
    })

    it("a sticky error is engine-error and carries the engine's note", async () => {
      const h = await setup()
      h.setActivity("error", { failure: "other", note: "400 invalid_request" })
      expect(h.verdict()).toMatchObject({ run: false, reason: "engine-error", detail: "400 invalid_request" })
    })

    it("a dead engine on an exact tab is engine-dead, unless the caller revives it", async () => {
      const h = await setup()
      h.setActivity("dead")
      expect(h.verdict()).toMatchObject({ run: false, reason: "engine-dead" })
      expect(h.verdict(TAB, { ignore: ["engine-dead"] })).toEqual({ run: true })
    })

    it("a permission prompt is awaiting-permission", async () => {
      const h = await setup()
      h.setActivity("permission_needed")
      expect(h.verdict()).toMatchObject({ reason: "awaiting-permission" })
    })

    describe("busy", () => {
      it("a running turn", async () => {
        const h = await setup()
        h.setActivity("running")
        expect(h.verdict()).toMatchObject({ run: false, reason: "busy" })
      })

      it("a delivery still awaiting its report, even with the engine idle", async () => {
        const h = await setup()
        h.setActivity("idle")
        const armed = await h.deliveries.arm({ taskId: TASK_ID, tabId: TAB, source: "send", promptHead: "tick" })
        expect(h.verdict()).toMatchObject({ run: false, reason: "busy" })
        await h.deliveries.setReport(armed.id, { outcome: "done", summary: "ok", evidence: [] })
        expect(h.verdict()).toEqual({ run: true })
      })

      it("an admitted-but-unpasted claim, until released or expired", async () => {
        const h = await setup()
        const claim = h.deliveries.claims.claim(TASK_ID, TAB)
        expect(h.verdict()).toMatchObject({ reason: "busy" })
        h.deliveries.claims.release(claim, false)
        expect(h.verdict()).toEqual({ run: true })
        h.deliveries.claims.claim(TASK_ID, TAB)
        h.advance(120_000)
        expect(h.verdict()).toEqual({ run: true })
      })

      it("an armed send's claim frees the moment the paste lands: its delivery says busy from there", async () => {
        const h = await setup()
        h.deliveries.claims.release(h.deliveries.claims.claim(TASK_ID, TAB, true), true)
        expect(h.verdict()).toEqual({ run: true })
      })

      it("a landed paste keeps the tab busy briefly, until its turn-start can arrive", async () => {
        const h = await setup()
        h.deliveries.claims.release(h.deliveries.claims.claim(TASK_ID, TAB), true)
        expect(h.verdict()).toMatchObject({ reason: "busy" })
        h.advance(20_000)
        expect(h.verdict()).toEqual({ run: true })
      })

      it("ranks below every reason the owner can act on", async () => {
        const h = await setup()
        h.setActivity("running")
        h.state.activity.set("*", { state: "running" })
        await h.gates.raise({ taskId: TASK_ID, question: "?" })
        expect(h.verdict()).toMatchObject({ reason: "awaiting-owner" })
      })
    })

    it("a tab about to be created is judged on task-level state: gates and unreported ticks, not the other tabs' activity", async () => {
      const h = await setup()
      h.setActivity("running")
      expect(h.verdict("new")).toEqual({ run: true })
      const missing = await h.missingDelivery()
      expect(h.verdict("new")).toMatchObject({ reason: "report-missing" })
      await h.deliveries.dismiss(missing.id)
      await h.gates.raise({ taskId: TASK_ID, question: "?" })
      expect(h.verdict("new")).toMatchObject({ reason: "awaiting-owner" })
    })

    it("tabId null judges the task's rollup", async () => {
      const h = await setup()
      h.state.activity.set("*", { state: "running" })
      expect(h.verdict(null)).toMatchObject({ reason: "busy" })
    })
  })

  describe("skipped deliveries", () => {
    it("fold repeats of the same refusal into one row, so a ticker cannot flush the report history", async () => {
      const h = await setup()
      const skip = (reason: "busy" | "quota") =>
        h.deliveries.recordSkipped({
          taskId: TASK_ID,
          tabId: TAB,
          source: "send",
          promptHead: "tick",
          skipped: { run: false, reason },
        })
      await skip("busy")
      await skip("busy")
      await skip("busy")
      expect(h.deliveries.listForTask(TASK_ID)).toHaveLength(1)
      expect(h.deliveries.listForTask(TASK_ID)[0]).toMatchObject({ status: "skipped", repeats: 3 })
      await skip("quota")
      expect(h.deliveries.listForTask(TASK_ID)).toHaveLength(2)
    })
  })

  describe("send.admit / send.release", () => {
    async function rpcSetup() {
      const h = await setup()
      h.setActivity("idle")
      const ctx = {
        orch: { getTask: () => h.state.task },
        activity: { entryOf: (_t: string, tab: string | null) => h.state.activity.get(tab ?? "*") },
        gates: h.gates,
        deliveries: h.deliveries,
        inbox: { deleteDeliveryEpisode: async () => true },
      } as unknown as DaemonHandlerContext
      const registry = createDaemonHandlerRegistry()
      const rpc = (name: string, payload: Record<string, unknown>) =>
        dispatchDaemonRequest(registry, name, payload, ctx) as Promise<Record<string, unknown>>
      return { ...h, rpc }
    }

    it("two concurrent ticks: the second is told busy, and a failed paste frees the tab", async () => {
      const h = await rpcSetup()
      const [first, second] = await Promise.all([
        h.rpc("send.admit", { taskId: TASK_ID, tabId: TAB, promptHead: "tick" }),
        h.rpc("send.admit", { taskId: TASK_ID, tabId: TAB, promptHead: "tick" }),
      ])
      expect(first.claimId).toBeDefined()
      expect(second).toMatchObject({ skipped: { run: false, reason: "busy" } })
      await h.rpc("send.release", { claimId: first.claimId, delivered: false })
      expect(await h.rpc("send.admit", { taskId: TASK_ID, tabId: TAB, promptHead: "tick" })).toHaveProperty("claimId")
    })

    it("a skip that would have owed a report is recorded as a skipped delivery, and arms nothing", async () => {
      const h = await rpcSetup()
      const gate = await h.gates.raise({ taskId: TASK_ID, question: "?" })
      const reply = await h.rpc("send.admit", {
        taskId: TASK_ID,
        tabId: TAB,
        promptHead: "tick",
        expectReport: true,
      })
      expect(reply.skipped).toMatchObject({ reason: "awaiting-owner", gateIds: [gate.id] })
      const rows = h.deliveries.listForTask(TASK_ID)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ status: "skipped", skipped: { reason: "awaiting-owner" } })
      expect(h.deliveries.awaitingFor(TASK_ID, TAB)).toBeUndefined()
    })

    it("a skip of a send that owes no report leaves no delivery row", async () => {
      const h = await rpcSetup()
      h.setActivity("running")
      const reply = await h.rpc("send.admit", { taskId: TASK_ID, tabId: TAB, promptHead: "tick" })
      expect(reply.skipped).toMatchObject({ reason: "busy" })
      expect(h.deliveries.listForTask(TASK_ID)).toHaveLength(0)
    })

    it("an admitted send arms its delivery when the task requires reports", async () => {
      const h = await rpcSetup()
      h.state.task = task({ requireReport: true })
      const reply = await h.rpc("send.admit", { taskId: TASK_ID, tabId: TAB, promptHead: "tick" })
      expect(reply).toMatchObject({ deliveryId: expect.stringMatching(/^d-\d+$/) })
      expect(h.deliveries.awaitingFor(TASK_ID, TAB)).toBeDefined()
    })

    it("a dead engine on the canonical tab is not a skip: send revives it", async () => {
      const h = await rpcSetup()
      h.state.activity.set("*", { state: "dead" })
      expect(await h.rpc("send.admit", { taskId: TASK_ID, promptHead: "tick" })).toHaveProperty("claimId")
      h.setActivity("dead")
      expect(await h.rpc("send.admit", { taskId: TASK_ID, tabId: TAB, promptHead: "tick" })).toMatchObject({
        skipped: { reason: "engine-dead" },
      })
    })

    it("attention.dismiss on a delivery row records the dismissal the verdict reads", async () => {
      const h = await rpcSetup()
      const missing = await h.missingDelivery()
      expect(h.verdict()).toMatchObject({ reason: "report-missing" })
      await h.rpc("attention.dismiss", { taskId: TASK_ID, deliveryId: missing.id })
      expect(h.verdict()).toEqual({ run: true })
    })
  })

  describe("routines", () => {
    const TARGET = { kind: "existing-tab", taskId: TASK_ID, tabId: "tab-2" } as const
    const blocked: RunnabilityVerdict = { run: false, reason: "busy", detail: "a turn is running" }

    async function routineSetup(overrides: Parameters<typeof automation>[0] = {}) {
      const dir = mkdtempSync(join(tmpdir(), "rove-runnability-routine-"))
      dirs.push(dir)
      const store = new AutomationsStore(join(dir, "automations.json"), () => NOW)
      await store.init()
      const routine = await store.create({ ...automation(overrides), schedule: "* * * * *" })
      const deliverTab = vi.fn(async (target: { tabId: string }) => ({
        outcome: "delivered" as const,
        tabId: target.tabId,
      }))
      const deliver = vi.fn(async () => ({ outcome: "delivered" as const, tabId: "tab-1" }))
      const fake = fakeDeps({ store, tasks: { [TASK_ID]: task() }, deliverTab, deliver })
      const check = vi.fn(() => blocked)
      const freshQuota = vi.fn((): SkipVerdict | undefined => undefined)
      return { store, routine, deliverTab, deliver, check, freshQuota, ...fake }
    }

    it("an existing-tab firing at a busy task is recorded skipped_blocked, with no paste and no delivery armed", async () => {
      const f = await routineSetup({ target: TARGET })
      const status = await runAutomationOnce(
        { ...f.deps, runnability: { check: f.check, freshQuota: f.freshQuota } },
        f.routine,
        { scheduledFor: NOW, trigger: "scheduled" },
      )
      expect(status).toBe("skipped_blocked")
      expect(f.deliverTab).not.toHaveBeenCalled()
      expect(f.deliveries.armed).toEqual([])
      const [run] = f.store.runsFor(f.routine.id)
      expect(run).toMatchObject({ status: "skipped_blocked", blocked, taskId: TASK_ID, tabId: "tab-2" })
      expect(run?.error).toContain("busy")
      expect(f.check).toHaveBeenCalledWith(TASK_ID, "tab-2")
    })

    it("does not raise a routine failure episode: the underlying cause is already in the Inbox", async () => {
      const f = await routineSetup({ target: TARGET })
      await runAutomationOnce({ ...f.deps, runnability: { check: f.check, freshQuota: f.freshQuota } }, f.routine, {
        scheduledFor: NOW,
        trigger: "scheduled",
      })
      expect(f.episodes.size).toBe(0)
    })

    it("a manual run-now bypasses it, as it does the precheck", async () => {
      const f = await routineSetup({ target: TARGET })
      const status = await runAutomationOnce(
        { ...f.deps, runnability: { check: f.check, freshQuota: f.freshQuota } },
        f.routine,
        { scheduledFor: NOW, trigger: "manual" },
      )
      expect(status).toBe("dispatched")
      expect(f.check).not.toHaveBeenCalled()
    })

    it("a standing session with a dead engine keeps the revive path: only engine-dead is ignored", async () => {
      const f = await routineSetup({ persistentSession: true, sessionTaskId: TASK_ID })
      const check = vi.fn(() => ({ run: true }) as RunnabilityVerdict)
      await dispatchAutomation({ ...f.deps, runnability: { check, freshQuota: f.freshQuota } } as never, f.routine)
      expect(check).toHaveBeenCalledWith(TASK_ID, null, ["engine-dead"])
    })

    it("a standing session whose task is awaiting the owner skips rather than reviving", async () => {
      const f = await routineSetup({ persistentSession: true, sessionTaskId: TASK_ID })
      const outcome = await dispatchAutomation(
        { ...f.deps, runnability: { check: f.check, freshQuota: f.freshQuota } } as never,
        f.routine,
      )
      expect(outcome).toMatchObject({ status: "skipped_blocked", taskId: TASK_ID, blocked })
      expect(f.deliver).not.toHaveBeenCalled()
    })

    it("a fresh-task firing skips on a known-exhausted vendor quota before creating a worktree", async () => {
      const f = await routineSetup()
      const quota = { run: false, reason: "quota", until: UNTIL } as const
      const outcome = await dispatchAutomation(
        { ...f.deps, runnability: { check: f.check, freshQuota: () => quota } } as never,
        f.routine,
      )
      expect(outcome).toMatchObject({ status: "skipped_blocked", blocked: quota })
      expect(f.created).toEqual([])
      expect(f.check).not.toHaveBeenCalled()
    })

    it("freshQuota reads only the cached snapshot, and an unknown quota is no reason to skip", () => {
      const deps = {} as RunnabilityDeps
      const exhausted = { windows: [{ percent: 100, resetsAt: NOW + 1000 }] }
      const runnable = createDispatchRunnability({ ...deps, now: () => NOW }, { peek: () => null }, "claude")
      expect(runnable.freshQuota(undefined)).toBeUndefined()
      const limited = createDispatchRunnability(
        { ...deps, now: () => NOW },
        { peek: (vendor) => (vendor === "claude" ? (exhausted as never) : null) },
        "claude",
      )
      expect(limited.freshQuota(undefined)).toEqual({
        run: false,
        reason: "quota",
        until: new Date(NOW + 1000).toISOString(),
      })
      expect(limited.freshQuota("codex")).toBeUndefined()
    })
  })

  describe("quota-resume", () => {
    function resumeRig(runnability: DispatchRunnability["check"]) {
      const due = task({
        quotaResume: { resumeAt: new Date(NOW - 1000).toISOString(), requestedAt: new Date(NOW - 5000).toISOString() },
      })
      const setQuotaResume = vi.fn(async () => {})
      const orch = { listTasks: () => [due], getTask: () => due, setQuotaResume } as never
      const deliverPromptToLiveEngine = vi.fn(async () => true)
      const runtime = { deliverPromptToLiveEngine } as unknown as DaemonRuntimeAdapter
      const run = async (settled: () => void): Promise<void> => {
        const stop = startQuotaResumeRunner(orch, runtime, 5, () => NOW, undefined, {
          check: runnability,
          freshQuota: () => undefined,
        })
        try {
          await vi.waitFor(settled)
        } finally {
          stop()
        }
      }
      return { run, setQuotaResume, deliverPromptToLiveEngine }
    }

    it("does not resume a task awaiting the owner, and drops the schedule rather than holding it", async () => {
      const check = vi.fn(() => ({ run: false, reason: "awaiting-owner", gateIds: ["g-1"] }) as RunnabilityVerdict)
      const rig = resumeRig(check)
      // The decline path clears the schedule and returns; nothing is ever delivered after it.
      await rig.run(() => expect(rig.setQuotaResume).toHaveBeenCalled())
      expect(check).toHaveBeenCalledWith(TASK_ID, null, ["quota"])
      expect(rig.setQuotaResume).toHaveBeenCalledWith(TASK_ID, null)
      expect(rig.deliverPromptToLiveEngine).not.toHaveBeenCalled()
    })

    it("resumes a task whose only block was the quota", async () => {
      const rig = resumeRig(() => ({ run: true }))
      await rig.run(() => expect(rig.deliverPromptToLiveEngine).toHaveBeenCalled())
      expect(rig.deliverPromptToLiveEngine).toHaveBeenCalled()
    })
  })
})
