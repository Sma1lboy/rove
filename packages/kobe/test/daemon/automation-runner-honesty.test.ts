import { writeFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { runAutomationOnce, sweepAutomations } from "../../../kobe-daemon/src/daemon/automation-runner.ts"
import { NOW, REPO, automation, fakeDeps, tempStore } from "./automation-runner-fixtures.ts"

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
    const a = await store.create(automation())
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
    const a = await store.create(automation())
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
    await runAutomationOnce(
      deps as never,
      await store.create(automation({ precheck: { command: "false", timeoutSeconds: 5 } })),
      {
        scheduledFor: NOW,
        trigger: "scheduled",
      },
    )
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
