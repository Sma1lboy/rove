import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import type { DaemonRpcClient } from "../../../kobe-daemon/src/client/rpc.ts"
import type { DispatchRuntime } from "../../../kobe-daemon/src/daemon/automation-dispatch.ts"
import {
  dueAutomations,
  resolveDueOccurrence,
  runAutomationOnce,
  startAutomationRunner,
  sweepAutomations,
} from "../../../kobe-daemon/src/daemon/automation-runner.ts"
import { AutomationsStore } from "../../../kobe-daemon/src/daemon/automations-store.ts"
import type { Automation, DaemonTask } from "../../../kobe-daemon/src/daemon/contracts.ts"

const NOW = new Date(2026, 6, 31, 10, 0, 0).getTime() // Fri 2026-07-31 10:00 local
const HOUR = 3_600_000
/** A real directory: prechecks spawn with `cwd: automation.repo`. */
const REPO = process.cwd()

function automation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: "auto-1",
    name: "audit",
    repo: REPO,
    prompt: "run the audit",
    schedule: "0 9 * * *",
    enabled: true,
    nextRunAt: new Date(NOW).toISOString(),
    missedRunGraceMinutes: 60,
    createdAt: new Date(NOW - 30 * 24 * HOUR).toISOString(),
    updatedAt: new Date(NOW - 30 * 24 * HOUR).toISOString(),
    ...overrides,
  }
}

async function tempStore(now = () => NOW): Promise<AutomationsStore> {
  const dir = mkdtempSync(join(tmpdir(), "kobe-automation-runner-"))
  const store = new AutomationsStore(join(dir, "automations.json"), now)
  await store.init()
  return store
}

const link = {} as DaemonRpcClient

function fakeDeps(args: {
  store: AutomationsStore
  createTask?: (input: unknown) => Promise<DaemonTask>
  start?: DispatchRuntime["startTaskSessionWithPrompt"]
  /** Tasks `resolveStandingTask` can find, keyed by id. */
  tasks?: Record<string, DaemonTask>
  deliver?: DispatchRuntime["deliverPromptToLiveEngineDetailed"]
}) {
  const created: unknown[] = []
  const prompts: string[] = []
  const delivered: string[] = []
  /** One slot per routine — the store's real dedupe shape, so the test can
   *  tell "refreshed the same episode" from "filed another one". */
  const episodes = new Map<string, { name: string; status: string; error?: string; taskId: string | null }>()
  const inbox = {
    recordPromptDeferred: async () => {},
    recordRoutineFailure: async (
      routine: { automationId: string; name: string; status: string; error?: string },
      taskId: string | null,
    ) => {
      episodes.set(routine.automationId, { ...routine, taskId })
    },
    deleteRoutineEpisode: async (automationId: string) => {
      episodes.delete(automationId)
    },
  }
  return {
    created,
    prompts,
    delivered,
    episodes,
    inbox,
    deps: {
      store: args.store,
      inbox,
      orch: {
        createTask:
          args.createTask ??
          (async (input: unknown) => {
            created.push(input)
            return { id: "task-1" } as DaemonTask
          }),
        getTask: (id: string) => args.tasks?.[id],
      },
      runtime: {
        startTaskSessionWithPrompt:
          args.start ??
          (async (_l: DaemonRpcClient, _id: string, prompt: string) => {
            prompts.push(prompt)
            return { started: true }
          }),
        deliverPromptToLiveEngineDetailed:
          args.deliver ??
          (async (_task: unknown, prompt: string) => {
            delivered.push(prompt)
            return { outcome: "delivered" as const, tabId: "tab-1" }
          }),
      },
      link,
      now: () => NOW,
    },
  }
}

describe("dueAutomations", () => {
  it("selects only enabled schedules whose time has arrived", () => {
    const list = [
      automation({ id: "due" }),
      automation({ id: "future", nextRunAt: new Date(NOW + HOUR).toISOString() }),
      automation({ id: "disabled", enabled: false }),
      automation({ id: "bad-date", nextRunAt: "not-a-date" }),
    ]
    expect(dueAutomations(list, NOW).map((a) => a.id)).toEqual(["due"])
  })
})

describe("resolveDueOccurrence", () => {
  it("reports the occurrence that should have run, not the current time", () => {
    // Fired at 10:00 for a 09:00 daily schedule.
    const found = resolveDueOccurrence(automation(), NOW)
    expect(new Date(found?.scheduledFor ?? 0).getHours()).toBe(9)
  })

  it("marks an occurrence inside the grace window as runnable", () => {
    // 10:00 now, 09:00 scheduled, 60m grace → exactly at the edge, still fine.
    expect(resolveDueOccurrence(automation(), NOW)?.missed).toBe(false)
  })

  it("marks an occurrence past the grace window as missed", () => {
    const found = resolveDueOccurrence(automation({ missedRunGraceMinutes: 30 }), NOW)
    expect(found?.missed).toBe(true)
  })

  it("will not claim occurrences from before the automation existed", () => {
    // Created at 09:30, so today's 09:00 is not its occurrence.
    const fresh = automation({ createdAt: new Date(NOW - 30 * 60_000).toISOString() })
    expect(resolveDueOccurrence(fresh, NOW)).toBeNull()
  })

  it("a zero grace still runs an occurrence discovered on the next tick", () => {
    // The sweep is a poller: it can only ever see an occurrence AFTER it
    // happened, so `now - scheduledFor` lands somewhere in 0..tickMs on a
    // perfectly healthy run. Without a one-tick floor, grace 0 made `missed`
    // true on every single firing — the automation recorded `skipped_missed`
    // forever and never dispatched, while zero looks like a sane setting.
    const zero = automation({
      schedule: "*/5 * * * *",
      missedRunGraceMinutes: 0,
      createdAt: new Date(0).toISOString(),
    })
    const scheduled = new Date(2026, 6, 31, 10, 5, 0).getTime()
    const out = resolveDueOccurrence(zero, scheduled + 30_000)
    expect(out?.scheduledFor).toBe(scheduled)
    expect(out?.missed).toBe(false)
  })

  it("still calls a genuinely late occurrence missed with a zero grace", () => {
    // The floor is ONE tick, not an amnesty: 10 minutes after the fact is a
    // real outage and must still be skipped rather than fired stale. A daily
    // schedule, so 10 minutes late really is late — under `*/5` the resolver
    // would just hand back the newer occurrence.
    const zero = automation({ missedRunGraceMinutes: 0 })
    const scheduled = new Date(2026, 6, 31, 9, 0, 0).getTime()
    expect(resolveDueOccurrence(zero, scheduled + 10 * 60_000)?.missed).toBe(true)
    // …while the tick that discovers it is still on time.
    expect(resolveDueOccurrence(zero, scheduled + 30_000)?.missed).toBe(false)
  })

  it("scales the floor with the runner's own tick period", () => {
    // A harness (or a future slower cadence) passes its real tickMs, so the
    // floor tracks the poll it actually runs at rather than the default 60s.
    const zero = automation({
      schedule: "*/5 * * * *",
      missedRunGraceMinutes: 0,
      createdAt: new Date(0).toISOString(),
    })
    const scheduled = new Date(2026, 6, 31, 10, 5, 0).getTime()
    const seenAt = scheduled + 90_000
    expect(resolveDueOccurrence(zero, seenAt)?.missed).toBe(true)
    expect(resolveDueOccurrence(zero, seenAt, 120_000)?.missed).toBe(false)
  })

  it("returns the single most recent occurrence after a long outage", () => {
    // Daemon down for three days: the answer is yesterday's 09:00 (one run),
    // never a stampede of every missed day.
    const found = resolveDueOccurrence(automation(), NOW + 3 * 24 * HOUR)
    expect(found?.scheduledFor).toBe(new Date(2026, 7, 3, 9, 0).getTime())
  })
})

describe("runAutomationOnce", () => {
  it("creates a task and starts its engine with the prompt", async () => {
    const store = await tempStore()
    const { deps, created, prompts } = fakeDeps({ store })
    const a = automation()

    const status = await runAutomationOnce(deps, a, { scheduledFor: NOW, trigger: "scheduled" })

    expect(status).toBe("dispatched")
    expect(created).toEqual([{ repo: REPO, title: "audit" }])
    expect(prompts).toEqual(["run the audit"])
    expect(store.runsFor(a.id)[0]).toMatchObject({ status: "dispatched", taskId: "task-1" })
  })

  it("passes vendor and baseRef through to task creation", async () => {
    const store = await tempStore()
    const { deps, created } = fakeDeps({ store })
    await runAutomationOnce(deps, automation({ vendor: "codex", baseRef: "develop" }), {
      scheduledFor: NOW,
      trigger: "scheduled",
    })
    expect(created[0]).toMatchObject({ vendor: "codex", baseRef: "develop" })
  })

  it("skips without creating a task when the precheck fails", async () => {
    const store = await tempStore()
    const { deps, created } = fakeDeps({ store })
    const a = automation({ precheck: { command: "exit 1", timeoutSeconds: 10 } })

    const status = await runAutomationOnce(deps, a, { scheduledFor: NOW, trigger: "scheduled" })

    expect(status).toBe("skipped_precheck")
    // The whole point of a precheck: no engine, no token spend.
    expect(created).toEqual([])
    expect(store.runsFor(a.id)[0]?.precheckResult?.exitCode).toBe(1)
  })

  it("proceeds when the precheck exits zero", async () => {
    const store = await tempStore()
    const { deps, created } = fakeDeps({ store })
    const a = automation({ precheck: { command: "exit 0", timeoutSeconds: 10 } })

    expect(await runAutomationOnce(deps, a, { scheduledFor: NOW, trigger: "scheduled" })).toBe("dispatched")
    expect(created).toHaveLength(1)
  })

  it("ignores the precheck on a manual trigger", async () => {
    const store = await tempStore()
    const { deps, created } = fakeDeps({ store })
    // Asking for it by hand IS the answer to "is this worth running".
    const a = automation({ precheck: { command: "exit 1", timeoutSeconds: 10 } })

    expect(await runAutomationOnce(deps, a, { scheduledFor: NOW, trigger: "manual" })).toBe("dispatched")
    expect(created).toHaveLength(1)
  })

  it("records skipped_unavailable when the repo is gone", async () => {
    const store = await tempStore()
    const { deps } = fakeDeps({
      store,
      createTask: async () => {
        throw new Error("repo not found")
      },
    })
    const a = automation()

    expect(await runAutomationOnce(deps, a, { scheduledFor: NOW, trigger: "scheduled" })).toBe("skipped_unavailable")
    expect(store.runsFor(a.id)[0]?.error).toMatch(/repo not found/)
  })

  it("records dispatch_failed but keeps the task id when the engine will not start", async () => {
    const store = await tempStore()
    const { deps } = fakeDeps({
      store,
      start: async () => ({
        started: false,
        error: "engine process never started; last session output: command not found",
      }),
    })
    const a = automation()

    expect(await runAutomationOnce(deps, a, { scheduledFor: NOW, trigger: "scheduled" })).toBe("dispatch_failed")
    // The task exists; surfacing its id lets the user open and retry it.
    expect(store.runsFor(a.id)[0]).toMatchObject({ status: "dispatch_failed", taskId: "task-1" })
  })
})

describe("sweepAutomations", () => {
  it("advances the schedule past the fired occurrence", async () => {
    const store = await tempStore()
    const created = await store.create({
      name: "audit",
      repo: REPO,
      prompt: "p",
      schedule: "*/15 * * * *",
      missedRunGraceMinutes: 60,
    })
    const { deps } = fakeDeps({ store })
    // Force it due.
    await store.advanceNextRun(created.id, NOW - 60_000)

    await sweepAutomations(deps)

    expect(Date.parse(store.get(created.id)?.nextRunAt ?? "")).toBeGreaterThan(NOW)
  })

  it("does not fire the same occurrence twice across overlapping sweeps", async () => {
    const store = await tempStore()
    const created = await store.create({
      name: "audit",
      repo: REPO,
      prompt: "p",
      schedule: "*/15 * * * *",
      missedRunGraceMinutes: 60,
    })
    const { deps, prompts } = fakeDeps({ store })
    await store.advanceNextRun(created.id, NOW - 60_000)

    await sweepAutomations(deps)
    await sweepAutomations(deps)

    expect(prompts).toHaveLength(1)
  })

  it("records skipped_missed without dispatching when past the grace window", async () => {
    // The daemon was down when 09:00 came around and only came back at 10:00,
    // outside the 30m grace. Arming a schedule whose nextRunAt is already in
    // the past is exactly what a persisted file looks like after an outage.
    const dir = mkdtempSync(join(tmpdir(), "kobe-automation-missed-"))
    const path = join(dir, "automations.json")
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        automations: [
          {
            id: "missed",
            name: "audit",
            repo: REPO,
            prompt: "p",
            schedule: "0 9 * * *",
            enabled: true,
            nextRunAt: new Date(NOW - HOUR).toISOString(),
            missedRunGraceMinutes: 30,
            createdAt: new Date(NOW - 30 * 24 * HOUR).toISOString(),
            updatedAt: new Date(NOW - 30 * 24 * HOUR).toISOString(),
          },
        ],
        runs: [],
      }),
    )
    const store = new AutomationsStore(path, () => NOW)
    await store.init()
    const { deps, created: tasks } = fakeDeps({ store })

    await sweepAutomations(deps)

    expect(tasks).toEqual([])
    expect(store.runsFor("missed")[0]?.status).toBe("skipped_missed")
    // And the schedule still moved on, so the stale occurrence cannot re-fire.
    expect(Date.parse(store.get("missed")?.nextRunAt ?? "")).toBeGreaterThan(NOW)
  })

  it("picks up a schedule armed by a previous daemon (restart survival)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kobe-automation-restart-"))
    const path = join(dir, "automations.json")

    // Daemon #1 arms a schedule, then dies.
    const first = new AutomationsStore(path, () => NOW - HOUR)
    await first.init()
    const created = await first.create({
      name: "audit",
      repo: REPO,
      prompt: "p",
      schedule: "*/15 * * * *",
      missedRunGraceMinutes: 60,
    })

    // Daemon #2 boots fresh with no in-memory timers whatsoever.
    const second = new AutomationsStore(path, () => NOW)
    await second.init()
    const { deps, prompts } = fakeDeps({ store: second })

    await sweepAutomations(deps)

    // Fired purely off the persisted nextRunAt — no re-arm pass exists.
    expect(prompts).toEqual(["p"])
    expect(second.get(created.id)).toBeDefined()
  })
})

describe("startAutomationRunner", () => {
  it("is disabled by a zero tick (the test harness contract)", async () => {
    const store = await tempStore()
    const { deps } = fakeDeps({ store })
    const spy = vi.spyOn(store, "list")
    const stop = startAutomationRunner(deps, 0)
    stop()
    expect(spy).not.toHaveBeenCalled()
  })

  it("stops cleanly", async () => {
    const store = await tempStore()
    const { deps } = fakeDeps({ store })
    const stop = startAutomationRunner(deps, 60_000)
    expect(() => stop()).not.toThrow()
  })
})

/**
 * A schedule is the only thing in Rove that acts with nobody watching, so the
 * queue that says "this needs you" is the only place its failures can land.
 * These pin the two rules that make that queue readable rather than noise.
 */
describe("routine failures in the Inbox", () => {
  it("files one episode per ROUTINE, however many firings fail", async () => {
    const store = await tempStore()
    const { deps, episodes } = fakeDeps({
      store,
      start: async () => ({ started: false, error: "engine process never started" }),
    })
    const a = automation()
    for (let firing = 0; firing < 10; firing += 1) {
      await runAutomationOnce(deps as never, a, { scheduledFor: NOW, trigger: "scheduled" })
    }
    // A fresh-task routine mints a new task every firing, so an episode keyed
    // on the task would be 10 rows here — and 1,440 a day for a broken
    // per-minute schedule.
    expect(episodes.size).toBe(1)
    expect(episodes.get(a.id)).toMatchObject({ name: "audit", status: "dispatch_failed" })
  })

  it("clears the episode once the routine runs cleanly again", async () => {
    const store = await tempStore()
    const { deps, episodes } = fakeDeps({
      store,
      start: async () => ({ started: false, error: "engine process never started" }),
    })
    const a = automation()
    await runAutomationOnce(deps as never, a, { scheduledFor: NOW, trigger: "scheduled" })
    expect(episodes.size).toBe(1)

    const healthy = fakeDeps({ store, start: async () => ({ started: true }) })
    // Same episode map: a fixed routine must not keep a permanent scar.
    healthy.episodes.set(a.id, { name: "audit", status: "dispatch_failed", taskId: null })
    await runAutomationOnce(healthy.deps as never, a, { scheduledFor: NOW, trigger: "scheduled" })
    expect(healthy.episodes.size).toBe(0)
  })

  it("stays quiet for a precheck that found nothing to do", async () => {
    const store = await tempStore()
    const { deps, episodes } = fakeDeps({ store })
    // `false` exits non-zero: healthy, and filing it would train the user to
    // ignore the queue.
    await runAutomationOnce(deps as never, automation({ precheck: { command: "false", timeoutSeconds: 5 } }), {
      scheduledFor: NOW,
      trigger: "scheduled",
    })
    expect(episodes.size).toBe(0)
  })
})

/**
 * The sweep is serial and its ticker drops re-entrant ticks, so one slow
 * precheck stalls every routine behind it. The stall is survivable; a history
 * that does not mention it is not — `latestCronAtOrBefore` returns only the
 * newest occurrence, so the ones passed over used to leave no trace at all.
 */
describe("occurrences the sweep never reached", () => {
  it("records how many were passed over, and when the first was due", async () => {
    const store = await tempStore()
    // Armed for 09:55; the sweep only gets here at 10:00, so 09:55 (the one it
    // was armed for) through 09:59 are occurrences that will never run — five
    // of a per-minute schedule. 10:00 is the one it does run.
    const created = await store.create({
      name: "minute",
      repo: REPO,
      prompt: "p",
      schedule: "* * * * *",
      missedRunGraceMinutes: 60,
    })
    await store.update(created.id, {})
    writeFileSync(
      (store as unknown as { path: string }).path,
      JSON.stringify({
        version: 1,
        automations: [{ ...created, nextRunAt: new Date(NOW - 5 * 60_000).toISOString() }],
        runs: [],
      }),
    )
    await store.init()

    const { deps } = fakeDeps({ store })
    await sweepAutomations(deps as never)

    const runs = store.runsFor(created.id)
    const gap = runs.find((run) => run.status === "skipped_missed")
    expect(gap?.error).toBe(`5 earlier occurrences never ran (from ${new Date(NOW - 5 * 60_000).toISOString()})`)
    // The occurrence it DID reach still runs — the gap row is a record, not a
    // replacement for the firing.
    expect(runs.some((run) => run.status === "dispatched")).toBe(true)
  })

  it("stays silent when the sweep arrived on time", async () => {
    // Armed one minute ago, swept now: the healthy case, and the one that must
    // not grow a second row.
    const store = await tempStore(() => NOW - 60_000)
    const created = await store.create({
      name: "minute",
      repo: REPO,
      prompt: "p",
      schedule: "* * * * *",
      missedRunGraceMinutes: 60,
    })
    const { deps } = fakeDeps({ store })
    await sweepAutomations(deps as never)
    expect(store.runsFor(created.id).map((run) => run.status)).toEqual(["dispatched"])
  })
})
