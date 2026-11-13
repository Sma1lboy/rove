import { DaemonActivityRegistry } from "@sma1lboy/rove-daemon/daemon/activity-registry"
import { DaemonEventBus } from "@sma1lboy/rove-daemon/daemon/event-bus"
import { afterEach, describe, expect, it, vi } from "vitest"

const TTL_MS = 30

/** Every `engine-state` payload the bus publishes, narrowed to the fields under test. */
function engineStates<T>(bus: DaemonEventBus): () => T[] {
  const events: { channel: string; payload: unknown }[] = []
  bus.onPublish((event) => events.push(event))
  return () => events.filter((e) => e.channel === "engine-state").map((e) => e.payload as T)
}

describe("daemon activity state", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([
    [
      "turn-complete",
      ["running", "turn_complete"],
      (r: DaemonActivityRegistry) => {
        // A real completion follows a tracked turn — a bare Stop with no turn in
        // flight is an automated wake and completes nothing.
        r.report("task-1", "turn-start")
        r.report("task-1", "turn-complete")
      },
    ],
    // The whole point of the ? badge: a task blocked on a permission prompt is
    // exactly what a user leaves the session to handle. A blocked engine writes
    // no transcript, so the liveness probe reads "stale" — the badge must NOT
    // lapse to idle regardless, or "come back and see who's stuck" breaks.
    [
      "permission_needed",
      ["permission_needed"],
      (r: DaemonActivityRegistry) => {
        r.report("task-1", "awaiting-input", { waiting: "permission" })
      },
    ],
  ] as const)("keeps %s visible instead of lapsing it to idle after the TTL", async (_name, expected, drive) => {
    vi.useFakeTimers()
    const bus = new DaemonEventBus()
    const published = engineStates<{ state: string }>(bus)
    // A probe that always reports a dead transcript: only stickiness keeps it lit.
    const registry = new DaemonActivityRegistry(
      bus,
      TTL_MS,
      () => Date.now(),
      () => Promise.resolve({ mtimeMs: 0 }),
    )

    drive(registry)
    await vi.advanceTimersByTimeAsync(TTL_MS * 10)

    expect(published().map((p) => p.state)).toEqual(expected)
    registry.close()
  })

  it("keeps error / rate_limited sticky — no lapse timer armed for either", () => {
    // Even with a probe that always reports "dead" (mtime 0), a blocked/errored
    // engine must stay lit. These states arm no lapse at all, so no timer exists
    // to fire; the badge clears only on the next real event / clearTask.
    const bus = new DaemonEventBus()
    const registry = new DaemonActivityRegistry(
      bus,
      TTL_MS,
      () => Date.now(),
      () => Promise.resolve({ mtimeMs: 0 }),
    )

    registry.report("task-err", "turn-failed", { failure: "other" })
    registry.report("task-rl", "turn-failed", { failure: "rate_limit" })

    expect(registry.replaySnapshot().map((p) => [p.taskId, p.state])).toEqual([
      ["task-err", "error"],
      ["task-rl", "rate_limited"],
    ])
    registry.close()
  })

  // Why: the reducer now has ONE definition (rove-daemon activity-reduce;
  // rove/src/engine/hook-events.ts re-exports it). These two behaviors were
  // paid for with production bugs and were only pinned on the rove side —
  // this is the daemon path they actually ship on.
  it("a Stop on a COLD registry completes the turn — it outlived a daemon restart", () => {
    const bus = new DaemonEventBus()
    const registry = new DaemonActivityRegistry(bus, 1_000)
    const published = engineStates<{ taskId: string; state: string }>(bus)
    let seen = 0
    const fresh = () => published().slice(seen)

    // No prior entry for this task: a restart wiped the in-memory registry
    // while a turn was in flight, so its Stop is the first event since boot.
    // Swallowing it cost the ● lamp for every turn outliving a restart.
    registry.report("task-cold", "turn-complete")
    expect(published()).toMatchObject([{ taskId: "task-cold", state: "turn_complete" }])

    // A Stop on a KNOWN untracked state is the other case — an automated
    // wake (a background monitor stream ending), which must NOT light the
    // ● lamp: the state stays idle.
    registry.report("task-warm", "session-start")
    seen = published().length
    registry.report("task-warm", "turn-complete")
    expect(fresh()).toMatchObject([{ taskId: "task-warm", state: "idle" }])

    registry.close()
  })

  // Why: Kimi fires Interrupt INSTEAD of Stop on a user interrupt
  // (docs/design/plugin-events.md §B) — without the verb landing on idle the
  // turn strands in `running` and the spinner never stops.
  it("turn-interrupted lands the state back on idle", () => {
    const bus = new DaemonEventBus()
    const registry = new DaemonActivityRegistry(bus, 1_000)

    registry.report("task-1", "turn-start")
    expect(registry.replaySnapshot().map((p) => p.state)).toEqual(["running"])

    registry.report("task-1", "turn-interrupted")
    expect(registry.replaySnapshot()).toEqual([])

    registry.close()
  })

  // Why: the F7 attention jump's tab precision rides these — a tabId-carrying
  // report must ledger per-tab (published + replayed with the tabId), the
  // task-level rollup must stay identical for every existing consumer, and a
  // question dialog (`awaiting-input` waiting:"input") is a blocking
  // attention state, not `running`.
  it("tracks tabId-carrying reports per tab: publish, replay, session-end + clearTask cleanup", () => {
    const bus = new DaemonEventBus()
    const registry = new DaemonActivityRegistry(bus, 1_000)
    const all = engineStates<{ taskId: string; tabId?: string; state: string }>(bus)
    let seen = 0
    const published = () =>
      all()
        .slice(seen)
        .map((p) => ({ taskId: p.taskId, tabId: p.tabId, state: p.state }))

    registry.report("task-1", "awaiting-input", { waiting: "input" }, "tab-2")
    // Two publishes per tab report: the tab entry, then the DERIVED task
    // rollup that follows from it (activity-rollup.ts).
    expect(published()).toEqual([
      { taskId: "task-1", tabId: "tab-2", state: "permission_needed" },
      { taskId: "task-1", tabId: undefined, state: "permission_needed" },
    ])
    // Replay carries the task rollup AND the tab entry.
    expect(registry.replaySnapshot().map((p) => [p.taskId, p.tabId, p.state])).toEqual([
      ["task-1", undefined, "permission_needed"],
      ["task-1", "tab-2", "permission_needed"],
    ])

    // A tab's session-end drops its per-tab entry (idle is never stored).
    registry.report("task-1", "session-end", undefined, "tab-2")
    expect(registry.replaySnapshot()).toEqual([])

    // clearTask publishes per-tab idles so subscribers drop tab candidates.
    registry.report("task-1", "turn-start", undefined, "tab-3")
    registry.report("task-1", "turn-complete", undefined, "tab-3")
    seen = all().length
    registry.clearTask("task-1")
    expect(published()).toEqual([
      { taskId: "task-1", tabId: "tab-3", state: "idle" },
      { taskId: "task-1", tabId: undefined, state: "idle" },
    ])

    registry.close()
  })

  // Why: sessionId is the "which engine session is live here" resolver —
  // including user-typed `claude` (cwd-matched, no tabId). It must ride the
  // payload, survive events that omit it (older `rove hook` binaries), and
  // replay to late subscribers, or session discovery silently regresses.
  it("stores the reporting session's identity, carries it forward, and replays it", () => {
    const bus = new DaemonEventBus()
    const registry = new DaemonActivityRegistry(bus, 1_000)
    const all = engineStates<{ state: string; sessionId?: string; transcriptPath?: string }>(bus)
    const published = () =>
      all().map((p) => ({ state: p.state, sessionId: p.sessionId, transcriptPath: p.transcriptPath }))

    registry.report("task-1", "turn-start", undefined, "tab-1", {
      id: "sess-abc",
      transcriptPath: "/tmp/sess-abc.jsonl",
    })
    expect(published()[0]).toEqual({ state: "running", sessionId: "sess-abc", transcriptPath: "/tmp/sess-abc.jsonl" })

    // An event WITHOUT session info keeps the latest-known id (carry-forward)
    // on both the tab entry and the rollup derived from it. `published[2]` is
    // the tab publish — index 1 is the task rollup that followed the first.
    registry.report("task-1", "turn-complete", undefined, "tab-1")
    expect(published()[2]).toEqual({
      state: "turn_complete",
      sessionId: "sess-abc",
      transcriptPath: "/tmp/sess-abc.jsonl",
    })

    // Replay (late subscriber) carries it too — task rollup + tab entry.
    expect(registry.replaySnapshot().map((p) => (p as { sessionId?: string }).sessionId)).toEqual([
      "sess-abc",
      "sess-abc",
    ])

    registry.close()
  })

  // Why: if the task-level carry-forward rode along on tab-tagged publishes,
  // a session-less event on a FRESH tab (codex hooks pipe no session id)
  // would inherit the previous tab's — even another ENGINE's — session and
  // stamp it onto the new tab forever. A tab publish must carry only the
  // tab's own lineage.
  it("a session-less event on a NEW tab does not inherit another tab's session", () => {
    const bus = new DaemonEventBus()
    const registry = new DaemonActivityRegistry(bus, 1_000)
    const published = engineStates<{ tabId?: string; sessionId?: string }>(bus)

    registry.report("task-1", "session-start", undefined, "tab-a", {
      id: "claude-sess",
    })
    // A different engine boots in tab-b; its hooks pipe NO session id.
    registry.report("task-1", "session-start", undefined, "tab-b")

    const last = published()
      .filter((p) => p.tabId)
      .at(-1)
    expect(last?.tabId).toBe("tab-b")
    expect(last?.sessionId).toBeUndefined()
    registry.close()
  })
})

/**
 * The ledger holds known-idle TAB entries on purpose (the client draws
 * absence as unknown), so "what is in the ledger" and "what is working" are
 * different questions. One reader answering both reported every task that had
 * ever opened a tab as busy — which pinned the worktree-changes collector's
 * 2 s cadence on worktrees nothing was writing to.
 */
describe("activity readers", () => {
  function world() {
    let now = 1_000
    const registry = new DaemonActivityRegistry(new DaemonEventBus(), 60_000, () => now)
    return {
      registry,
      tick(ms: number) {
        now += ms
      },
    }
  }

  it("a task whose only tab was observed idle is not a working task", () => {
    const { registry, tick } = world()
    registry.report("quiet", "turn-start", undefined, "tab-1", { id: "s1", transcriptPath: "/s1" }, "claude")
    registry.report("busy", "turn-start", undefined, "tab-1", { id: "s2", transcriptPath: "/s2" }, "claude")
    tick(5_000)
    expect(registry.observeTab("quiet", "tab-1", "rest", { correctHookRunningAfterMs: 1_000 })).toBe(
      "corrected-hook-running",
    )

    expect(registry.workingTaskIds()).toEqual(["busy"])
    // The entry survives the idle — that is exactly what the old reader
    // mistook for work.
    expect(registry.replaySnapshot().filter((p) => p.taskId === "quiet")).toMatchObject([
      { tabId: "tab-1", state: "idle" },
    ])
    registry.close()
  })

  it("liveSessions keeps an idle tab holding a session, and skips a tab without one", () => {
    const { registry, tick } = world()
    registry.report("t", "turn-start", undefined, "with-session", { id: "s1", transcriptPath: "/s1" }, "claude")
    registry.report("t", "turn-start", undefined, "no-session")
    tick(5_000)
    registry.observeTab("t", "with-session", "rest", { correctHookRunningAfterMs: 1_000 })

    expect(registry.liveSessions()).toMatchObject([{ tabId: "with-session", state: "idle", sessionId: "s1" }])
    registry.close()
  })
})
