/**
 * Should-run (docs/design/long-run-controls.md § 2) from the schedulers' side:
 * the routine runner records `skipped_blocked` instead of dispatching, and
 * quota-resume declines a task the owner must look at.
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
import type { DaemonTask, EngineQuotaUsage } from "../../../rove-daemon/src/daemon/contracts.ts"
import { DeliveriesStore } from "../../../rove-daemon/src/daemon/deliveries-store.ts"
import { type DeliveryDeps, trackDeliveryTurn } from "../../../rove-daemon/src/daemon/delivery-ops.ts"
import { GatesStore } from "../../../rove-daemon/src/daemon/gates-store.ts"
import { startQuotaResumeRunner } from "../../../rove-daemon/src/daemon/quota-resume.ts"
import type { RunnabilityVerdict, SkipVerdict } from "../../../rove-daemon/src/daemon/runnability-contracts.ts"
import {
  type ActivityReading,
  type RunnabilityDeps,
  createDispatchRunnability,
} from "../../../rove-daemon/src/daemon/runnability.ts"
import type { DaemonRuntimeAdapter } from "../../../rove-daemon/src/daemon/runtime.ts"
import { NOW, REPO, automation, fakeDeps } from "./automation-runner-fixtures.ts"

const TASK_ID = "t1"
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

describe("should-run in the schedulers", () => {
  const dirs: string[] = []
  afterEach(async () => {
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
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

    it.each([
      ["engine-dead", "dispatch_failed", 1],
      ["engine-error", "dispatch_failed", 1],
      ["awaiting-owner", "skipped_blocked", 0],
      ["report-missing", "skipped_blocked", 0],
      ["quota", "skipped_blocked", 0],
      ["busy", "skipped_blocked", 0],
      ["awaiting-permission", "skipped_blocked", 0],
    ] as const)("a %s refusal is recorded %s and raises %i routine_failed alarm", async (reason, status, alarms) => {
      const f = await routineSetup({ target: TARGET })
      const check = vi.fn(() => ({ run: false, reason }) as RunnabilityVerdict)
      const outcome = await runAutomationOnce(
        { ...f.deps, runnability: { check, freshQuota: f.freshQuota } },
        f.routine,
        { scheduledFor: NOW, trigger: "scheduled" },
      )
      expect(outcome).toBe(status)
      expect(f.deliverTab).not.toHaveBeenCalled()
      // The verdict stays on the run either way, so the row says why.
      expect(f.store.runsFor(f.routine.id)[0]).toMatchObject({ status, blocked: { reason }, error: reason })
      expect(f.episodes.size).toBe(alarms)
    })

    it("a dead bound tab keeps its alarm across firings instead of being muted by the skip", async () => {
      const f = await routineSetup({ target: TARGET })
      const dead = vi.fn(() => ({ run: false, reason: "engine-dead" }) as RunnabilityVerdict)
      for (let n = 0; n < 2; n++) {
        await runAutomationOnce({ ...f.deps, runnability: { check: dead, freshQuota: f.freshQuota } }, f.routine, {
          scheduledFor: NOW + n,
          trigger: "scheduled",
        })
      }
      expect(f.episodes.size).toBe(1)
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

    /** Real deliveries and gates, so the verdict reads what the hooks actually wrote. */
    async function liveRig(peek: () => EngineQuotaUsage | null = () => null) {
      const dir = mkdtempSync(join(tmpdir(), "rove-runnability-quota-"))
      dirs.push(dir)
      const clock = { ms: NOW }
      const deliveries = new DeliveriesStore(join(dir, "deliveries.json"), () => clock.ms)
      await deliveries.init()
      const gates = new GatesStore(join(dir, "gates.json"), () => new Date(clock.ms))
      await gates.init()
      const state = {
        task: task({
          requireReport: true,
          quotaResume: { resumeAt: new Date(NOW + 3_600_000).toISOString(), requestedAt: new Date(NOW).toISOString() },
        }),
        activity: { state: "rate_limited", detail: { failure: "rate_limit" } } as ActivityReading,
      }
      const runnability = createDispatchRunnability(
        {
          orch: { getTask: () => state.task },
          activity: { entryOf: () => state.activity },
          gates,
          deliveries,
          now: () => clock.ms,
        },
        { peek },
        "claude",
      )
      const setQuotaResume = vi.fn(async (_id: string, next: DaemonTask["quotaResume"] | null) => {
        state.task = task({ ...state.task, quotaResume: next ?? undefined })
      })
      const orch = { listTasks: () => [state.task], getTask: () => state.task, setQuotaResume } as never
      const deliverPromptToLiveEngine = vi.fn(async () => true)
      const runtime = { deliverPromptToLiveEngine } as unknown as DaemonRuntimeAdapter
      const sweep = async (): Promise<void> => {
        const stop = startQuotaResumeRunner(orch, runtime, 5, () => clock.ms, undefined, runnability)
        try {
          await vi.waitFor(() => expect(setQuotaResume).toHaveBeenCalled())
        } finally {
          stop()
        }
      }
      return { clock, deliveries, gates, state, runnability, sweep, deliverPromptToLiveEngine }
    }

    it("a rate limit that ended a requireReport tick resumes at the reset: its own missing delivery is not a decline", async () => {
      const rig = await liveRig()
      const armed = await rig.deliveries.arm({ taskId: TASK_ID, tabId: null, source: "send", promptHead: "tick" })
      const deliveryDeps = { deliveries: rig.deliveries } as unknown as DeliveryDeps
      await trackDeliveryTurn(deliveryDeps, TASK_ID, null, "turn-start", undefined)
      await trackDeliveryTurn(deliveryDeps, TASK_ID, null, "turn-failed", { failure: "rate_limit" })
      expect(rig.deliveries.get(armed.id)).toMatchObject({ status: "missing", missing: { cause: "rate-limited" } })
      expect(rig.runnability.check(TASK_ID, null)).toEqual({ run: false, reason: "quota", until: UNTIL })

      rig.clock.ms = NOW + 3_600_001
      await rig.sweep()
      expect(rig.deliverPromptToLiveEngine).toHaveBeenCalled()
      rig.state.activity = { state: "idle" }
      expect(rig.runnability.check(TASK_ID, null)).toEqual({ run: true })
      // The continued turn's late report still lands.
      await rig.deliveries.setReport(armed.id, { outcome: "done", summary: "finished", evidence: [] })
      expect(rig.deliveries.get(armed.id)?.status).toBe("reported")
    })

    it("a decline for another reason does not strand the sticky badge: the quota ends at its reset, or is not held", async () => {
      const reset = NOW + 7_200_000
      const usage: EngineQuotaUsage = {
        capturedAt: NOW,
        windows: [{ kind: "five_hour", label: "5h", percent: 100, resetsAt: reset }],
      }
      const rig = await liveRig(() => usage)
      await rig.gates.raise({ taskId: TASK_ID, question: "Ship it?" })
      rig.clock.ms = NOW + 3_600_001
      await rig.sweep()
      expect(rig.deliverPromptToLiveEngine).not.toHaveBeenCalled()
      expect(rig.state.task.quotaResume).toBeUndefined()
      for (const gate of rig.gates.list({ taskId: TASK_ID, status: "open" })) await rig.gates.withdraw(gate.id)
      expect(rig.runnability.check(TASK_ID, null)).toEqual({
        run: false,
        reason: "quota",
        until: new Date(reset).toISOString(),
      })
      rig.clock.ms = reset
      expect(rig.runnability.check(TASK_ID, null)).toEqual({ run: true })
    })
  })
})
