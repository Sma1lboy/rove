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
import type { DaemonTask } from "../../../rove-daemon/src/daemon/contracts.ts"
import { startQuotaResumeRunner } from "../../../rove-daemon/src/daemon/quota-resume.ts"
import type { RunnabilityVerdict, SkipVerdict } from "../../../rove-daemon/src/daemon/runnability-contracts.ts"
import { type RunnabilityDeps, createDispatchRunnability } from "../../../rove-daemon/src/daemon/runnability.ts"
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
