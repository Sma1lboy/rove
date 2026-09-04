/**
 * Quiet backoff — the collector's fourth guard, on a different axis from
 * the three that defend against a SLOW repo (in-flight dedupe, timeout +
 * hard backoff, adaptive cadence). This one defends against an UNCHANGED
 * one: 19 idle tasks were costing 1280 `git` processes per 62 seconds to
 * publish 19 frames.
 *
 * The rule under test: skip the spawns ONLY when the change probe read
 * cleanly, read the same thing as at the last run's start, no engine is
 * working in that worktree, and the safety poll is not yet due. The probe
 * cannot see a content edit (see worktree-probe.ts), so every other case has
 * to fall through and poll — that is what makes the optimisation safe.
 *
 * Only `Date` is faked: the collector's run completions are real promises,
 * so faking `setTimeout` would stall `settle()`.
 */

import { DaemonEventBus } from "@sma1lboy/kobe-daemon/daemon/event-bus"
import { WorktreeChangesCollector } from "@sma1lboy/kobe-daemon/daemon/worktree-changes-collector"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { type Task, toTaskId } from "../../src/types/task.ts"

function task(id: string): Task {
  return {
    id: toTaskId(id),
    title: id,
    repo: "/repo",
    branch: id,
    worktreePath: `/wt/${id}`,
    status: "backlog",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as Task
}

/** Cadence with a zero floor, so only the quiet backoff can hold a tick off. */
const FAST = { timeoutMs: 1_000, slowRetryMs: 1_000, minIntervalMs: 0 }
const QUIET_MS = 10_000

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
}

interface HarnessOptions {
  readonly probe: () => string | null
  readonly activeTaskIds?: () => string[]
  readonly tasks?: Task[]
}

function harness(opts: HarnessOptions) {
  /** Runs per worktree path — "did it spawn?" as a number. */
  const runs = new Map<string, number>()
  const collector = new WorktreeChangesCollector({ listTasks: () => opts.tasks ?? [task("a")] }, new DaemonEventBus(), {
    cadence: FAST,
    publishDelayMs: 0,
    quietIntervalMs: QUIET_MS,
    probe: opts.probe,
    ...(opts.activeTaskIds ? { activeTaskIds: opts.activeTaskIds } : {}),
    run: async (path) => {
      runs.set(path, (runs.get(path) ?? 0) + 1)
      return { added: 1, deleted: 0 }
    },
  })
  /** Tick at an absolute fake time and let the run settle. */
  const tickAt = async (at: number): Promise<void> => {
    vi.setSystemTime(at)
    collector.tick()
    await settle()
  }
  return { runs: (path = "/wt/a") => runs.get(path) ?? 0, tickAt }
}

describe("worktree-changes quiet backoff", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(0)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  test("an unchanged fingerprint stops the spawns until the safety poll is due", async () => {
    const h = harness({ probe: () => "same" })

    await h.tickAt(0)
    expect(h.runs()).toBe(1)

    for (let t = 1_000; t <= 9_000; t += 1_000) await h.tickAt(t)
    expect(h.runs()).toBe(1)

    // Past the safety interval it polls anyway: the probe cannot see a
    // content edit, so the relaxed poll is what keeps the counts honest.
    await h.tickAt(QUIET_MS + 1)
    expect(h.runs()).toBe(2)
  })

  test("a moved fingerprint polls on the very next tick", async () => {
    let fingerprint = "v1"
    const h = harness({ probe: () => fingerprint })

    await h.tickAt(0)
    await h.tickAt(1_000)
    expect(h.runs()).toBe(1)

    fingerprint = "v2"
    await h.tickAt(2_000)
    expect(h.runs()).toBe(2)
  })

  test("an unreadable probe always polls — no fingerprint, no backoff", async () => {
    const h = harness({ probe: () => null })

    for (let t = 0; t <= 3_000; t += 1_000) await h.tickAt(t)
    expect(h.runs()).toBe(4)
  })

  test("a worktree whose engine is working keeps the fast cadence", async () => {
    // An engine writing `src/**` is exactly what the fingerprint is blind to.
    const h = harness({ probe: () => "same", activeTaskIds: () => ["a"] })

    for (let t = 0; t <= 3_000; t += 1_000) await h.tickAt(t)
    expect(h.runs()).toBe(4)
  })

  test("an active task in ANOTHER worktree does not exempt this one", async () => {
    const h = harness({ probe: () => "same", activeTaskIds: () => ["b"], tasks: [task("a"), task("b")] })

    for (let t = 0; t <= 3_000; t += 1_000) await h.tickAt(t)
    expect(h.runs("/wt/a")).toBe(1)
    expect(h.runs("/wt/b")).toBe(4)
  })
})
