import { existsSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { dispatchAutomation } from "../../../kobe-daemon/src/daemon/automation-dispatch.ts"
import {
  runAutomationOnce,
  startAutomationRunner,
  sweepAutomations,
} from "../../../kobe-daemon/src/daemon/automation-runner.ts"
import { AutomationsStore } from "../../../kobe-daemon/src/daemon/automations-store.ts"
import type { DaemonTask } from "../../../kobe-daemon/src/daemon/contracts.ts"
import { DeferredPromptsStore } from "../../../kobe-daemon/src/daemon/deferred-prompts-store.ts"
import { NOW, REPO, automation, fakeDeps } from "./automation-runner-fixtures.ts"

const TARGET = { kind: "existing-tab", taskId: "existing", tabId: "tab-2" } as const
const TASK = {
  id: TARGET.taskId,
  title: "Existing conversation",
  repo: REPO,
  worktreePath: REPO,
  kind: "dir",
  status: "backlog",
  branch: "main",
  createdAt: new Date(NOW).toISOString(),
  updatedAt: new Date(NOW).toISOString(),
} satisfies DaemonTask

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "rove-routine-bound-"))
  const path = join(dir, "automations.json")
  let clock = NOW - 60_000
  const store = new AutomationsStore(path, () => clock)
  await store.init()
  const routine = await store.create({ ...automation(), target: TARGET, schedule: "* * * * *" })
  clock = NOW
  const deliverTab = vi.fn(async (target: { tabId: string }) => ({
    outcome: "delivered" as const,
    tabId: target.tabId,
  }))
  const fake = fakeDeps({ store, tasks: { [TASK.id]: TASK }, deliverTab })
  const deferred = new DeferredPromptsStore(join(dir, "deferred.json"), () => NOW)
  return { dir, path, store, routine, deliverTab, deferred, ...fake }
}

describe("existing-tab routine delivery", () => {
  it("an edit after claiming but before starting the run cancels the stale prompt", async () => {
    const f = await fixture()
    const claimed = await f.store.advanceNextRun(f.routine.id, NOW, f.routine.nextRunAt)
    expect(claimed).not.toBeNull()
    await f.store.update(f.routine.id, { prompt: "replacement" })
    expect(await runAutomationOnce(f.deps, claimed!, { trigger: "scheduled", scheduledFor: NOW })).toBe(
      "skipped_cancelled",
    )
    expect(f.deliverTab).not.toHaveBeenCalled()
  })

  it("concurrent sweeps claim one occurrence; restart retains the target without replay", async () => {
    const f = await fixture()
    await Promise.all([sweepAutomations(f.deps), sweepAutomations(f.deps), sweepAutomations(f.deps)])
    expect(f.deliverTab).toHaveBeenCalledTimes(1)
    expect(f.deliverTab).toHaveBeenCalledWith(
      expect.objectContaining({ id: TASK.id, tabId: "tab-2" }),
      f.routine.prompt,
    )
    expect(f.created).toEqual([])
    expect(f.prompts).toEqual([])
    expect(f.delivered).toEqual([])
    const reboot = new AutomationsStore(f.path, () => NOW)
    await reboot.init()
    expect(reboot.get(f.routine.id)?.target).toEqual(TARGET)
    expect(reboot.runsFor(f.routine.id)).toEqual([
      expect.objectContaining({ status: "dispatched", taskId: TASK.id, tabId: "tab-2" }),
    ])
    await sweepAutomations({ ...f.deps, store: reboot })
    expect(f.deliverTab).toHaveBeenCalledTimes(1)
  })

  it.each(["missing", "deleting", "repo-mismatch"])(
    "%s task never creates, revives or selects another target",
    async (state) => {
      const f = await fixture()
      const task =
        state === "missing"
          ? undefined
          : state === "repo-mismatch"
            ? { ...TASK, repo: tmpdir() }
            : { ...TASK, deletion: { requestedAt: "now" } }
      const outcome = await dispatchAutomation(
        { ...f.deps, orch: { ...f.deps.orch, getTask: () => task as DaemonTask | undefined }, link: () => f.deps.link },
        f.routine,
      )
      expect(outcome.status).toBe("skipped_unavailable")
      expect(f.deliverTab).not.toHaveBeenCalled()
      expect(f.created).toEqual([])
      expect(f.prompts).toEqual([])
    },
  )

  it.each(["no-session", "no-engine"] as const)(
    "%s records failure with exact tab and never revives",
    async (outcome) => {
      const f = await fixture()
      const runtime = {
        ...f.deps.runtime,
        deliverPromptToLiveEngineTabDetailed: async () => ({ outcome, tabId: TARGET.tabId }),
      }
      expect(await runAutomationOnce({ ...f.deps, runtime }, f.routine, { trigger: "manual", scheduledFor: NOW })).toBe(
        "dispatch_failed",
      )
      expect(f.store.runsFor(f.routine.id)[0]).toMatchObject({
        taskId: TASK.id,
        tabId: TARGET.tabId,
        status: "dispatch_failed",
      })
      expect(f.created).toEqual([])
      expect(f.prompts).toEqual([])
    },
  )

  it("busy acceptance belongs to the existing queue; disable and restart preserve its receipt", async () => {
    const f = await fixture()
    const runtime = {
      ...f.deps.runtime,
      deliverPromptToLiveEngineTabDetailed: async () => ({
        outcome: "busy" as const,
        tabId: TARGET.tabId,
        layer: "composer-not-empty" as const,
      }),
    }
    const deps = { ...f.deps, runtime, deferred: f.deferred }
    await sweepAutomations(deps)
    const record = (await f.deferred.list()).records[0]
    expect(record).toMatchObject({ taskId: TASK.id, tabId: TARGET.tabId, prompt: f.routine.prompt })
    expect(f.store.runsFor(f.routine.id)[0]).toMatchObject({
      status: "deferred",
      deferredId: record?.id,
      tabId: TARGET.tabId,
    })
    await f.store.update(f.routine.id, { enabled: false })
    const queue = new DeferredPromptsStore(join(f.dir, "deferred.json"), () => NOW)
    expect(await queue.list()).toEqual(await f.deferred.list())
    await runAutomationOnce(deps, f.store.get(f.routine.id)!, { trigger: "manual", scheduledFor: NOW })
    expect(f.store.runsFor(f.routine.id)[0]?.status).toBe("dispatch_failed")
    expect((await f.deferred.list()).records).toHaveLength(1)
  })

  it("keeps the queue receipt when its Inbox notification fails", async () => {
    const f = await fixture()
    const runtime = {
      ...f.deps.runtime,
      deliverPromptToLiveEngineTabDetailed: async () => ({
        outcome: "busy" as const,
        tabId: TARGET.tabId,
        layer: "composer-not-empty" as const,
      }),
    }
    const inbox = {
      ...f.inbox,
      recordPromptDeferred: async () => {
        throw new Error("notification unavailable")
      },
    }
    await runAutomationOnce({ ...f.deps, runtime, inbox, deferred: f.deferred }, f.routine, {
      trigger: "manual",
      scheduledFor: NOW,
    })
    expect(f.store.runsFor(f.routine.id)[0]).toMatchObject({
      status: "deferred",
      deferredId: expect.any(String),
      error: expect.stringContaining("Inbox notification failed"),
    })
    expect((await f.deferred.list()).records).toHaveLength(1)
  })

  it("a prior queued prompt blocks a newer firing even after the composer clears", async () => {
    const f = await fixture()
    await f.deferred.file({
      taskId: TARGET.taskId,
      tabId: TARGET.tabId,
      prompt: "older",
      layer: "recent-human-write",
      at: NOW,
    })
    await runAutomationOnce({ ...f.deps, deferred: f.deferred }, f.routine, { trigger: "manual", scheduledFor: NOW })
    expect(f.deliverTab).not.toHaveBeenCalled()
    expect(f.store.runsFor(f.routine.id)[0]?.status).toBe("dispatch_failed")
    expect((await f.deferred.list()).records[0]?.prompt).toBe("older")
  })

  it.each(["disable", "edit", "stop"])("%s after precheck began prevents delivery", async (action) => {
    const f = await fixture()
    const entered = join(f.dir, "entered")
    const release = join(f.dir, "release")
    const routine = await f.store.update(f.routine.id, {
      precheck: { command: `touch '${entered}'; while [ ! -f '${release}' ]; do sleep 0.01; done`, timeoutSeconds: 5 },
    })
    expect(routine).not.toBeNull()
    const stopped = action === "stop" ? startAutomationRunner(f.deps, 5) : undefined
    const running = stopped ? undefined : sweepAutomations(f.deps)
    await vi.waitFor(() => expect(existsSync(entered)).toBe(true))
    const stopping = stopped?.()
    if (action === "disable") await f.store.update(f.routine.id, { enabled: false })
    if (action === "edit") await f.store.update(f.routine.id, { prompt: "replacement" })
    writeFileSync(release, "go")
    await (stopping ?? running)
    expect(f.deliverTab).not.toHaveBeenCalled()
    expect(f.store.runsFor(f.routine.id)[0]?.status).toBe("skipped_cancelled")
  })

  it("a claimed occurrence is not replayed if the process dies before delivering", async () => {
    const f = await fixture()
    await f.store.advanceNextRun(f.routine.id, NOW, f.routine.nextRunAt)
    const restarted = new AutomationsStore(f.path, () => NOW)
    await restarted.init()
    await sweepAutomations({ ...f.deps, store: restarted })
    expect(f.deliverTab).not.toHaveBeenCalled()
    expect(restarted.runsFor(f.routine.id)).toEqual([])
  })
})
