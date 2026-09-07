import { readActivityLiveness } from "@sma1lboy/kobe-daemon/daemon/activity-liveness"
import {
  type ActivityLivenessProbe,
  DaemonActivityRegistry,
  type EngineStatePayload,
} from "@sma1lboy/kobe-daemon/daemon/activity-registry"
import { DaemonEventBus } from "@sma1lboy/kobe-daemon/daemon/event-bus"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { TaskActivityState } from "../../src/engine/hook-events.ts"

const TTL = 1_000

/**
 * Liveness watchdog (KOB-bug: a still-running task flips to idle after ~10min).
 *
 * A long single agent turn emits only `turn-start` … `Stop` over many minutes
 * with NO hook events in between, so a fixed lapse timer fires mid-turn and
 * wrongly idles a working agent. The watchdog probes the engine's
 * transcript mtime when the timer fires: a write within the trailing staleness
 * window means the turn is alive (re-arm instead of idling); a genuinely
 * silent engine (missed Stop / hung process) still lapses to idle. These tests
 * drive that with a FAKE clock + FAKE probe — no real filesystem.
 */
describe("activity registry liveness watchdog", () => {
  let bus: DaemonEventBus
  let states: Record<string, TaskActivityState[]>
  let registry: DaemonActivityRegistry | null

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    bus = new DaemonEventBus()
    states = {}
    bus.onPublish((event) => {
      if (event.channel !== "engine-state") return
      const payload = event.payload as EngineStatePayload
      const seen = states[payload.taskId] ?? []
      seen.push(payload.state)
      states[payload.taskId] = seen
    })
    registry = null
  })

  afterEach(() => {
    registry?.close()
    vi.useRealTimers()
  })

  it("re-arms (does not idle) a running turn whose transcript keeps advancing", async () => {
    // Probe always reports "written just now" ⇒ alive every window.
    const probe: ActivityLivenessProbe = vi.fn(() => Promise.resolve({ mtimeMs: Date.now() }))
    registry = new DaemonActivityRegistry(bus, TTL, () => Date.now(), probe)

    registry.report("t", "turn-start")
    expect(states.t).toEqual(["running"])

    // Cross three full TTL windows — a fixed timer would have idled at the
    // first; the heartbeat keeps it running.
    await vi.advanceTimersByTimeAsync(TTL)
    await vi.advanceTimersByTimeAsync(TTL)
    await vi.advanceTimersByTimeAsync(TTL)

    expect(states.t).toEqual(["running"])
    expect(probe).toHaveBeenCalledTimes(3)
  })

  it("idles a turn whose transcript kept advancing but ALREADY completed", async () => {
    // The reported bug: an engine parked at its prompt keeps touching its
    // transcript, so an mtime-only heartbeat re-armed forever and the sidebar
    // spun long after the turn ended (a missed Stop hook left `running` with
    // nothing to clear it). A completion at/after the turn start settles it.
    const probe: ActivityLivenessProbe = vi.fn(() => Promise.resolve({ mtimeMs: Date.now(), completedAt: Date.now() }))
    registry = new DaemonActivityRegistry(bus, TTL, () => Date.now(), probe)

    registry.report("t", "turn-start")
    expect(states.t).toEqual(["running"])

    await vi.advanceTimersByTimeAsync(TTL)

    expect(states.t).toEqual(["running", "idle"])
    // and it stays idle — no re-arm resurrects it
    await vi.advanceTimersByTimeAsync(TTL * 2)
    expect(states.t).toEqual(["running", "idle"])
  })

  it("keeps a long turn lit when the completion predates it (stale marker)", async () => {
    // A marker from the PREVIOUS turn must not idle the current one; only a
    // completion at/after this turn's start counts.
    const startedAt = Date.now()
    const probe: ActivityLivenessProbe = vi.fn(() =>
      Promise.resolve({ mtimeMs: Date.now(), completedAt: startedAt - 1 }),
    )
    registry = new DaemonActivityRegistry(bus, TTL, () => Date.now(), probe)

    registry.report("t", "turn-start")
    await vi.advanceTimersByTimeAsync(TTL)
    await vi.advanceTimersByTimeAsync(TTL)

    expect(states.t).toEqual(["running"])
  })

  it("probes with the policed entry's OWN session transcript (not just task+vendor)", async () => {
    // Several tabs share one worktree; a worktree-scoped probe read a
    // sibling's Stop as "this turn ended". The registry must hand the probe
    // the entry's own transcript so it can scope to THIS session.
    const probe: ActivityLivenessProbe = vi.fn(() => Promise.resolve({ mtimeMs: Date.now() }))
    registry = new DaemonActivityRegistry(bus, TTL, () => Date.now(), probe)

    registry.report("t", "turn-start", undefined, "tab-1", { id: "s1", transcriptPath: "/tp/s1.jsonl" }, "claude")
    await vi.advanceTimersByTimeAsync(TTL)

    // Both watchdogs (task-level and tab-level) probe with the same lineage.
    expect(probe).toHaveBeenCalledWith("t", "claude", "/tp/s1.jsonl")
    expect(vi.mocked(probe).mock.calls.every((call) => call[2] === "/tp/s1.jsonl")).toBe(true)
  })

  it("lapses to idle when the transcript has not advanced within the window", async () => {
    // Probe reports an mtime stuck at the report instant (epoch 0) — outside
    // the trailing window once the timer fires at TTL.
    const probe: ActivityLivenessProbe = vi.fn(() => Promise.resolve({ mtimeMs: 0 }))
    registry = new DaemonActivityRegistry(bus, TTL, () => Date.now(), probe)

    registry.report("t", "turn-start")
    await vi.advanceTimersByTimeAsync(TTL)

    expect(states.t).toEqual(["running", "idle"])
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it("cancels a pending rescheduled lapse when a later report arrives", async () => {
    let alive = true
    const probe: ActivityLivenessProbe = vi.fn(() => Promise.resolve(alive ? { mtimeMs: Date.now() } : { mtimeMs: 0 }))
    registry = new DaemonActivityRegistry(bus, TTL, () => Date.now(), probe)

    registry.report("t", "turn-start")
    // First window: alive ⇒ rescheduled. Exactly one pending timer remains.
    await vi.advanceTimersByTimeAsync(TTL)
    expect(vi.getTimerCount()).toBe(1)

    // A fresh event must clear the rescheduled timer and arm a new one — never
    // leak a second timer.
    registry.report("t", "turn-start")
    expect(vi.getTimerCount()).toBe(1)

    // Now go silent: only the post-report timer should fire and idle once.
    // (The second report re-publishes "running"; the reschedule itself never
    // publishes, so the lone "idle" proves no leaked timer double-idled.)
    alive = false
    await vi.advanceTimersByTimeAsync(TTL)
    expect(states.t).toEqual(["running", "running", "idle"])
  })

  it("debugSnapshot exposes the raw entries (state, vendor, armed watchdog)", async () => {
    const probe: ActivityLivenessProbe = vi.fn(() => Promise.resolve({ mtimeMs: Date.now() }))
    registry = new DaemonActivityRegistry(bus, TTL, () => Date.now(), probe)

    registry.report("t", "turn-start", undefined, "tab-1", undefined, "claude")
    registry.report("u", "turn-start")
    registry.report("u", "turn-complete")

    const snap = registry.debugSnapshot()
    expect(snap.tasks.t).toMatchObject({ state: "running", vendor: "claude", lapseArmed: true })
    // Sticky states are not policed — no watchdog armed.
    expect(snap.tasks.u).toMatchObject({ state: "turn_complete", lapseArmed: false })
    expect(snap.tabs.t?.["tab-1"]).toMatchObject({ state: "running", vendor: "claude", lapseArmed: true })
  })

  it("passes the REPORTING engine's vendor to the probe (custom wrapper ids)", async () => {
    // A task configured with a custom wrapper vendor (`claudecpa`) has no
    // transcript store under that id — the probe must ask about the engine
    // the hook actually reported (`--engine claude`), else mtime reads 0
    // and every long turn lapses mid-work.
    const probe: ActivityLivenessProbe = vi.fn(() => Promise.resolve({ mtimeMs: Date.now() }))
    registry = new DaemonActivityRegistry(bus, TTL, () => Date.now(), probe)

    registry.report("t", "turn-start", undefined, "tab-1", undefined, "claude")
    await vi.advanceTimersByTimeAsync(TTL)

    expect(probe).toHaveBeenCalledWith("t", "claude", undefined)
    // Carried forward: a later event without the tag keeps the known vendor.
    registry.report("t", "turn-start")
    await vi.advanceTimersByTimeAsync(TTL)
    expect(probe).toHaveBeenLastCalledWith("t", "claude", undefined)
  })

  it("falls back to lapsing when the probe throws (no crash)", async () => {
    const probe: ActivityLivenessProbe = vi.fn(() => Promise.reject(new Error("fs boom")))
    registry = new DaemonActivityRegistry(bus, TTL, () => Date.now(), probe)

    registry.report("t", "turn-start")
    await vi.advanceTimersByTimeAsync(TTL)

    expect(states.t).toEqual(["running", "idle"])
    expect(probe).toHaveBeenCalledTimes(1)
  })

  /**
   * Per-tab watchdog (turn-state consolidation): the tab strip's chip now
   * keys off the hook-driven per-tab `running`, so a missed Stop pinning a
   * tab entry would pin the ● indefinitely. The tab entry gets its own
   * probe-then-idle heartbeat; on lapse the daemon publishes a per-tab idle
   * so hook-wins subscribers fall back to the quiescence poll.
   */
  it("lapses a silent per-tab entry and publishes a tabId-scoped idle", async () => {
    const probe: ActivityLivenessProbe = vi.fn(() => Promise.resolve({ mtimeMs: 0 }))
    registry = new DaemonActivityRegistry(bus, TTL, () => Date.now(), probe)
    const tabEvents: { tabId?: string; state: TaskActivityState }[] = []
    bus.onPublish((event) => {
      if (event.channel !== "engine-state") return
      const payload = event.payload as EngineStatePayload & { tabId?: string }
      if (payload.tabId) tabEvents.push({ tabId: payload.tabId, state: payload.state })
    })

    registry.report("t", "turn-start", undefined, "tab-1")
    await vi.advanceTimersByTimeAsync(TTL)

    expect(tabEvents).toEqual([
      { tabId: "tab-1", state: "running" },
      { tabId: "tab-1", state: "idle" },
    ])
    // The lapsed tab entry must not linger in the replay set.
    expect(registry.currentNonIdle().filter((p) => "tabId" in p && p.tabId)).toEqual([])
  })

  it("keeps an alive per-tab running entry lit across windows (heartbeat)", async () => {
    const probe: ActivityLivenessProbe = vi.fn(() => Promise.resolve({ mtimeMs: Date.now() }))
    registry = new DaemonActivityRegistry(bus, TTL, () => Date.now(), probe)

    registry.report("t", "turn-start", undefined, "tab-1")
    await vi.advanceTimersByTimeAsync(TTL)
    await vi.advanceTimersByTimeAsync(TTL)

    const tabs = registry.currentNonIdle().filter((p) => "tabId" in p && p.tabId)
    expect(tabs).toHaveLength(1)
    expect(tabs[0]?.state).toBe("running")
  })

  it("sticky per-tab states (turn_complete) never lapse", async () => {
    const probe: ActivityLivenessProbe = vi.fn(() => Promise.resolve({ mtimeMs: 0 }))
    registry = new DaemonActivityRegistry(bus, TTL, () => Date.now(), probe)

    registry.report("t", "turn-start", undefined, "tab-1")
    registry.report("t", "turn-complete", undefined, "tab-1")
    await vi.advanceTimersByTimeAsync(TTL * 3)

    const tabs = registry.currentNonIdle().filter((p) => "tabId" in p && p.tabId)
    expect(tabs).toHaveLength(1)
    expect(tabs[0]?.state).toBe("turn_complete")
  })

  it("keeps unknown scoped evidence until its own completion arrives", async () => {
    const probe: ActivityLivenessProbe = async () => ({ unknown: true })
    registry = new DaemonActivityRegistry(bus, TTL, () => Date.now(), probe)
    registry.report("t", "turn-start", undefined, "tab-1", { id: "own", transcriptPath: "/own" })
    await vi.advanceTimersByTimeAsync(TTL * 3)
    expect(registry.currentNonIdle().every((entry) => entry.state === "running")).toBe(true)
    registry.report("t", "turn-complete", undefined, "tab-1")
    await vi.advanceTimersByTimeAsync(TTL * 2)
    expect(registry.currentNonIdle().every((entry) => entry.state === "turn_complete")).toBe(true)
  })

  it("replaces unknown evidence with a recovered session's own completion", async () => {
    let known = false
    registry = new DaemonActivityRegistry(
      bus,
      TTL,
      () => Date.now(),
      async () => (known ? { completedAt: Date.now() } : { unknown: true }),
    )
    registry.report("t", "turn-start")
    await vi.advanceTimersByTimeAsync(TTL)
    expect(states.t).toEqual(["running"])
    known = true
    await vi.advanceTimersByTimeAsync(TTL)
    expect(states.t).toEqual(["running", "idle"])
  })

  it("does not let an old probe clear a replacement session with the same timestamp", async () => {
    const finish: Array<(value: { completedAt: number }) => void> = []
    registry = new DaemonActivityRegistry(
      bus,
      TTL,
      () => 0,
      () =>
        new Promise((resolve) => {
          finish.push(resolve)
        }),
    )
    registry.report("t", "turn-start", undefined, "tab-1", { id: "old", transcriptPath: "/old" })
    await vi.advanceTimersByTimeAsync(TTL)
    registry.report("t", "turn-start", undefined, "tab-1", { id: "new", transcriptPath: "/new" })
    for (const resolve of finish) resolve({ completedAt: 1 })
    await vi.advanceTimersByTimeAsync(0)
    expect(registry.currentNonIdle()).toEqual(
      expect.arrayContaining([expect.objectContaining({ state: "running", sessionId: "new", transcriptPath: "/new" })]),
    )
    expect(registry.currentNonIdle().some((entry) => entry.state === "idle")).toBe(false)
  })

  it.each(["death", "rest"] as const)(
    "settles an unknown session's tab and task rollup after its own %s",
    async (evidence) => {
      registry = new DaemonActivityRegistry(
        bus,
        TTL,
        () => Date.now(),
        async () => ({ unknown: true }),
      )
      registry.report("t", "turn-start", undefined, "tab-1", { id: "own", transcriptPath: "/own" })
      await vi.advanceTimersByTimeAsync(TTL)
      if (evidence === "death") registry.recordEngineDeath("t", "tab-1", { code: 1 }, Date.now())
      else registry.observeTab("t", "tab-1", "rest", { correctHookRunningAfterMs: 0 })
      expect(vi.getTimerCount()).toBe(0)
      await vi.advanceTimersByTimeAsync(TTL * 2)
      expect(registry.currentNonIdle().some((entry) => entry.state === "running")).toBe(false)
    },
  )

  it("never clears a sibling's task rollup when the other tab ends", async () => {
    registry = new DaemonActivityRegistry(
      bus,
      TTL,
      () => Date.now(),
      async () => ({ unknown: true }),
    )
    registry.report("t", "turn-start", undefined, "tab-1", { id: "one", transcriptPath: "/one" })
    registry.report("t", "turn-start", undefined, "tab-2", { id: "two", transcriptPath: "/two" })
    registry.recordEngineDeath("t", "tab-1", { code: 1 }, Date.now())
    await vi.advanceTimersByTimeAsync(TTL)
    expect(registry.snapshotByTask().t).toMatchObject({ state: "running", transcriptPath: "/two" })
  })

  it("never idles after the entry was cleared during the probe await", async () => {
    let resolveProbe: ((v: { mtimeMs: number }) => void) | undefined
    const probe: ActivityLivenessProbe = vi.fn(
      () =>
        new Promise<{ mtimeMs: number }>((resolve) => {
          resolveProbe = resolve
        }),
    )
    registry = new DaemonActivityRegistry(bus, TTL, () => Date.now(), probe)

    registry.report("t", "turn-start")
    await vi.advanceTimersByTimeAsync(TTL) // timer fires, probe is now in flight
    registry.clearTask("t") // supersedes the in-flight lapse
    resolveProbe?.({ mtimeMs: 0 }) // would lapse, but the entry is gone
    await Promise.resolve()
    await Promise.resolve()

    // clearTask published idle; the resolved probe must NOT publish a second.
    expect(states.t).toEqual(["running", "idle"])
  })
})

/**
 * `readActivityLiveness` session scoping: several tabs share one worktree
 * (the kobe main task runs many tabs in one checkout), so the worktree-wide
 * completion scan read a SIBLING's Stop as "this turn ended" and idled a
 * genuinely mid-turn engine at the TTL. With the hook-piped transcript path
 * the probe must ask that one session; a vanished file stays unknown.
 */
describe("readActivityLiveness session scoping", () => {
  const orch = { getTask: () => ({ worktreePath: "/wt" }) }
  const runtimeWith = (detector?: Record<string, unknown>) =>
    ({
      defaultTaskVendor: "claude",
      latestTranscriptMtime: async () => 0,
      createEngineTurnDetector: () => (detector ? { supportsCompletionMarkers: () => true, ...detector } : undefined),
    }) as unknown as Parameters<typeof readActivityLiveness>[1]

  it("prefers the reporting session's own transcript over the worktree scan", async () => {
    const runtime = runtimeWith({
      latestActivity: async () => ({ marker: { id: "sibling", timestampMs: 999 }, mtimeMs: 999 }),
      latestActivityInFile: async () => ({ marker: { id: "own", timestampMs: 5 }, mtimeMs: 7 }),
    })
    await expect(readActivityLiveness(orch, runtime, "t", "claude", "/tp/s1.jsonl")).resolves.toEqual({
      mtimeMs: 7,
      completedAt: 5,
    })
  })

  it("preserves unknown when the exact session transcript is gone", async () => {
    const runtime = runtimeWith({
      latestActivity: async () => ({ marker: { id: "wide", timestampMs: 999 }, mtimeMs: 1000 }),
      latestActivityInFile: async () => null,
    })
    await expect(readActivityLiveness(orch, runtime, "t", "claude", "/tp/gone.jsonl")).resolves.toEqual({
      unknown: true,
    })
  })

  it("keeps a failed scoped read unknown instead of borrowing a sibling completion", async () => {
    const wide = vi.fn(async () => ({ marker: { id: "sibling", timestampMs: 999 }, mtimeMs: 1000 }))
    const runtime = runtimeWith({
      latestActivity: wide,
      latestActivityInFile: async () => {
        throw new Error("unreadable")
      },
    })
    expect(await readActivityLiveness(orch, runtime, "t", "claude", "/own")).toEqual({ unknown: true })
    expect(wide).not.toHaveBeenCalled()
  })

  it("scans the worktree when no transcript path was reported", async () => {
    const latestActivityInFile = vi.fn()
    const runtime = runtimeWith({
      latestActivity: async () => ({ marker: null, mtimeMs: 42 }),
      latestActivityInFile,
    })
    await expect(readActivityLiveness(orch, runtime, "t", "claude")).resolves.toEqual({ mtimeMs: 42 })
    expect(latestActivityInFile).not.toHaveBeenCalled()
  })

  it.each([true, false])(
    "probes only the identified file when marker support is unavailable (detector %s)",
    async (present) => {
      const home = await mkdtemp(join(tmpdir(), "rove-scoped-mtime-"))
      const own = join(home, "own.jsonl")
      const wide = vi.fn(async () => 999)
      const runtime = runtimeWith(present ? { supportsCompletionMarkers: () => false } : undefined)
      runtime.latestTranscriptMtime = wide
      try {
        expect(await readActivityLiveness(orch, runtime, "t", "generic", own)).toEqual({ unknown: true })
        expect(await readActivityLiveness(orch, runtime, "t", "generic", home)).toEqual({ unknown: true })
        await writeFile(own, "")
        expect(await readActivityLiveness(orch, runtime, "t", "generic", own)).toEqual({
          mtimeMs: (await stat(own)).mtimeMs,
        })
        expect(wide).not.toHaveBeenCalled()
      } finally {
        await rm(home, { recursive: true, force: true })
      }
    },
  )
})
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
