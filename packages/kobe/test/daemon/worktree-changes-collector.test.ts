/**
 * Daemon worktree-changes collector — the single `git status`
 * collector that replaces per-pane polling. What matters here:
 *
 *   - **Exclusions**: remote (`ssh://`) projects are never collected — a
 *     remote project's worktree isn't on this filesystem at all.
 *   - **Publish-on-change only**: a status pass that round-trips to the
 *     same counts publishes nothing — subscribed panes must not re-render
 *     rows on unchanged ticks (DESIGN §5.5, daemon side).
 *   - **Pruning**: a task deleted between ticks drops its entry
 *     from the published map (with a republish), and a status run that
 *     completes AFTER its entry was pruned must not resurrect it.
 *   - **In-flight dedupe**: ticks landing while a worktree's status is
 *     still running start nothing — the guard that keeps a slow repo at
 *     one background child, not one per tick.
 *
 * The runner is injected (no real git / worktrees); the cadence floor is
 * zeroed so successive ticks are immediately eligible. The pure timing
 * math (adaptive cadence, hard backoff) is covered by the shared
 * poll-scheduling tests — this file pins the collector's pass logic.
 */

import { DaemonEventBus } from "@sma1lboy/kobe-daemon/daemon/event-bus"
import type { WorktreeChangesPayload } from "@sma1lboy/kobe-daemon/daemon/protocol"
import {
  WorktreeChangesCollector,
  parseAheadBehind,
  trackedWorktreePaths,
} from "@sma1lboy/kobe-daemon/daemon/worktree-changes-collector"
import { describe, expect, test } from "vitest"
import type { WorktreeChanges } from "../../src/tui/panes/sidebar/worktree-changes.ts"
import { type Task, toTaskId } from "../../src/types/task.ts"

/** Minimal Task — only the fields the collector reads. */
function task(over: Omit<Partial<Task>, "id"> & { id: string }): Task {
  const { id, ...rest } = over
  return {
    id: toTaskId(id),
    title: id,
    repo: "/repo",
    branch: id,
    worktreePath: `/wt/${id}`,
    status: "backlog",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...rest,
  } as Task
}

/** Cadence with a zero floor so every tick is immediately eligible. */
const FAST = { timeoutMs: 1_000, slowRetryMs: 1_000, minIntervalMs: 0 }

/** Let the collector's fire-and-forget run completions settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
}

function harness(initialTasks: Task[], counts: Record<string, WorktreeChanges>) {
  let tasks = initialTasks
  const bus = new DaemonEventBus()
  const published: WorktreeChangesPayload[] = []
  bus.onPublish((event) => {
    if (event.channel === "worktree.changes") published.push(event.payload as WorktreeChangesPayload)
  })
  const runs: string[] = []
  const collector = new WorktreeChangesCollector({ listTasks: () => tasks }, bus, {
    cadence: FAST,
    publishDelayMs: 0,
    run: async (worktreePath) => {
      runs.push(worktreePath)
      const value = counts[worktreePath]
      if (!value) throw new Error("git status failed")
      return value
    },
  })
  const setTasks = (next: Task[]): void => {
    tasks = next
  }
  return { collector, published, runs, counts, setTasks }
}

describe("trackedWorktreePaths", () => {
  test("excludes remote projects and empty worktrees; dedupes shared paths", () => {
    const tasks = [
      task({ id: "a" }),
      task({ id: "remote", repo: "ssh://dev@build-box", worktreePath: "/remote/wt/remote" }),
      task({ id: "backlog", worktreePath: "" }),
      // Two main rows of the same repo share worktreePath = repo root.
      task({ id: "main1", kind: "main", repo: "/repo", worktreePath: "/repo" }),
      task({ id: "main2", kind: "main", repo: "/repo", worktreePath: "/repo" }),
    ]
    expect([...trackedWorktreePaths(tasks).keys()].sort()).toEqual(["/repo", "/wt/a"])
  })

  test("carries each path's recorded base ref, and the first task that has one wins", () => {
    // A `main` row records no base and shares the repo root with a based task;
    // whichever order they list in, the based task's answer must survive — the
    // behind count is measured against it.
    const tasks = [
      task({ id: "main", kind: "main", repo: "/repo", worktreePath: "/repo" }),
      task({ id: "based", repo: "/repo", worktreePath: "/repo", baseRef: "release/2.x" }),
      task({ id: "a", baseRef: "origin/main" }),
      task({ id: "none" }),
    ]
    const tracked = trackedWorktreePaths(tasks)
    expect(tracked.get("/repo")).toBe("release/2.x")
    expect(tracked.get("/wt/a")).toBe("origin/main")
    // A task with no recorded base is still tracked; the runner then falls
    // back to its own resolution.
    expect(tracked.has("/wt/none")).toBe(true)
    expect(tracked.get("/wt/none")).toBeUndefined()
  })
})

describe("WorktreeChangesCollector", () => {
  test("collects local worktrees and publishes the full map", async () => {
    const { collector, published, runs } = harness([task({ id: "a" })], {
      "/wt/a": { added: 2, deleted: 1 },
    })
    collector.tick()
    await settle()
    expect(runs).toEqual(["/wt/a"])
    expect(published.at(-1)).toEqual({ changes: { "/wt/a": { added: 2, deleted: 1 } } })
  })

  test("publishes only when counts actually changed", async () => {
    const { collector, published, counts } = harness([task({ id: "a" })], { "/wt/a": { added: 1, deleted: 0 } })
    collector.tick()
    await settle()
    expect(published.length).toBe(1)

    // Same counts again → no publish (panes must not re-render on noise).
    collector.tick()
    await settle()
    expect(published.length).toBe(1)

    // Changed counts → publish.
    counts["/wt/a"] = { added: 3, deleted: 0 }
    collector.tick()
    await settle()
    expect(published.length).toBe(2)
    expect(published.at(-1)).toEqual({ changes: { "/wt/a": { added: 3, deleted: 0 } } })
  })

  test("a failing run keeps the last published value (never errors, never publishes garbage)", async () => {
    const { collector, published, counts } = harness([task({ id: "a" })], { "/wt/a": { added: 1, deleted: 0 } })
    collector.tick()
    await settle()
    expect(published.length).toBe(1)

    // Worktree vanished / git failed → the entry's value survives untouched.
    counts["/wt/a"] = undefined as unknown as WorktreeChanges
    collector.tick()
    await settle()
    expect(published.length).toBe(1)
  })

  test("drops a deleted task's entry from the published map", async () => {
    const { collector, published, setTasks } = harness([task({ id: "a" }), task({ id: "b" })], {
      "/wt/a": { added: 1, deleted: 0 },
      "/wt/b": { added: 2, deleted: 2 },
    })
    collector.tick()
    await settle()
    expect(Object.keys(published.at(-1)?.changes ?? {}).sort()).toEqual(["/wt/a", "/wt/b"])

    // b deleted → its entry drops and the pruned map is republished.
    setTasks([task({ id: "a" })])
    collector.tick()
    await settle()
    expect(published.at(-1)).toEqual({ changes: { "/wt/a": { added: 1, deleted: 0 } } })
  })

  test("dedupes in-flight runs — a tick landing mid-status starts nothing", async () => {
    let release: ((v: WorktreeChanges) => void) | undefined
    const bus = new DaemonEventBus()
    const runs: string[] = []
    const collector = new WorktreeChangesCollector({ listTasks: () => [task({ id: "a" })] }, bus, {
      cadence: FAST,
      publishDelayMs: 0,
      run: (worktreePath) => {
        runs.push(worktreePath)
        return new Promise((r) => {
          release = r
        })
      },
    })
    collector.tick()
    collector.tick()
    collector.tick()
    expect(runs).toEqual(["/wt/a"])
    release?.({ added: 0, deleted: 0 })
    await settle()
  })

  test("a run completing after its task was pruned does not resurrect the entry", async () => {
    let release: ((v: WorktreeChanges) => void) | undefined
    const tasks = { current: [task({ id: "a" })] }
    const bus = new DaemonEventBus()
    const published: WorktreeChangesPayload[] = []
    bus.onPublish((event) => {
      if (event.channel === "worktree.changes") published.push(event.payload as WorktreeChangesPayload)
    })
    const collector = new WorktreeChangesCollector({ listTasks: () => tasks.current }, bus, {
      cadence: FAST,
      publishDelayMs: 0,
      run: () =>
        new Promise((r) => {
          release = r
        }),
    })
    collector.tick() // starts the run
    tasks.current = [] // task deleted while git status runs
    collector.tick() // prunes the (valueless) entry
    release?.({ added: 5, deleted: 5 })
    await settle()
    expect(published).toEqual([])
  })

  test("pauses entirely while hasSubscribers is false, resumes when true", async () => {
    let subscribed = false
    const bus = new DaemonEventBus()
    const published: WorktreeChangesPayload[] = []
    bus.onPublish((event) => {
      if (event.channel === "worktree.changes") published.push(event.payload as WorktreeChangesPayload)
    })
    const runs: string[] = []
    const collector = new WorktreeChangesCollector({ listTasks: () => [task({ id: "a" })] }, bus, {
      cadence: FAST,
      publishDelayMs: 0,
      hasSubscribers: () => subscribed,
      run: async (worktreePath) => {
        runs.push(worktreePath)
        return { added: 1, deleted: 0 }
      },
    })

    // Zero subscribers (gui-less daemon) → the tick spawns no git, publishes
    // nothing: no consumer-less disk/CPU churn.
    collector.tick()
    await settle()
    expect(runs).toEqual([])
    expect(published).toEqual([])

    // A pane subscribes → the next tick repopulates and publishes.
    subscribed = true
    collector.tick()
    await settle()
    expect(runs).toEqual(["/wt/a"])
    expect(published.at(-1)).toEqual({ changes: { "/wt/a": { added: 1, deleted: 0 } } })
  })

  test("collects unconditionally when hasSubscribers is omitted (back-compat)", async () => {
    const { collector, runs } = harness([task({ id: "a" })], { "/wt/a": { added: 2, deleted: 1 } })
    collector.tick()
    await settle()
    expect(runs).toEqual(["/wt/a"])
  })

  test("tick never throws when the task lister blows up", () => {
    const bus = new DaemonEventBus()
    const collector = new WorktreeChangesCollector(
      {
        listTasks: () => {
          throw new Error("store exploded")
        },
      },
      bus,
      { cadence: FAST, publishDelayMs: 0, run: async () => ({ added: 0, deleted: 0 }) },
    )
    expect(() => collector.tick()).not.toThrow()
  })
})

describe("the behind-base count", () => {
  test("hands the recorded base ref to the runner, and republishes when only it changed", async () => {
    // `sameWorktreeChanges` gates every publish. A worktree whose file counts
    // are unchanged but whose base has moved MUST still republish, or the
    // drift chip never appears until the user edits a file.
    const bus = new DaemonEventBus()
    const published: WorktreeChangesPayload[] = []
    bus.onPublish((event) => {
      if (event.channel === "worktree.changes") published.push(event.payload as WorktreeChangesPayload)
    })
    const seenBaseRefs: (string | undefined)[] = []
    let behind = 0
    const collector = new WorktreeChangesCollector(
      { listTasks: () => [task({ id: "a", baseRef: "release/2.x" })] },
      bus,
      {
        cadence: FAST,
        publishDelayMs: 0,
        run: async (_path, _signal, baseRef) => {
          seenBaseRefs.push(baseRef)
          return { added: 1, deleted: 0, behind }
        },
      },
    )
    collector.tick()
    await settle()
    expect(seenBaseRefs).toEqual(["release/2.x"])
    expect(published.at(-1)?.changes["/wt/a"]).toEqual({ added: 1, deleted: 0, behind: 0 })

    behind = 3
    collector.tick()
    await settle()
    expect(published.at(-1)?.changes["/wt/a"]).toEqual({ added: 1, deleted: 0, behind: 3 })
    expect(published).toHaveLength(2)

    // Same everything → no third publish.
    collector.tick()
    await settle()
    expect(published).toHaveLength(2)
  })

  test("a runner that reports no behind count publishes the counts without one", async () => {
    // The honest degradation for a repo with no resolvable base: the field is
    // absent, so the chip does not draw. Never a fabricated zero.
    const bus = new DaemonEventBus()
    const published: WorktreeChangesPayload[] = []
    bus.onPublish((event) => {
      if (event.channel === "worktree.changes") published.push(event.payload as WorktreeChangesPayload)
    })
    const collector = new WorktreeChangesCollector({ listTasks: () => [task({ id: "a" })] }, bus, {
      cadence: FAST,
      publishDelayMs: 0,
      run: async () => ({ added: 0, deleted: 2 }),
    })
    collector.tick()
    await settle()
    expect(published.at(-1)?.changes["/wt/a"]).toEqual({ added: 0, deleted: 2 })
    expect("behind" in (published.at(-1)?.changes["/wt/a"] ?? {})).toBe(false)
  })
})

describe("parseAheadBehind", () => {
  test("reads the left half as behind and the right half as ahead", () => {
    // `git rev-list --left-right --count <base>...HEAD` prints one tab-joined
    // line, base side first. Getting the halves the wrong way round would
    // render a worker who committed as one who fell behind.
    expect(parseAheadBehind("3\t7\n")).toEqual({ behind: 3, ahead: 7 })
  })

  test("a failed run leaves BOTH numbers absent", () => {
    // `runGit` hands null on any non-zero exit; neither half may be guessed
    // from the other's silence.
    expect(parseAheadBehind(null)).toBeNull()
  })

  test("a half-read line yields nothing rather than a guess", () => {
    // A single number is what the OLD one-way `--count` printed. Accepting it
    // would silently reinterpret a behind-count as a pair.
    expect(parseAheadBehind("3")).toBeNull()
    expect(parseAheadBehind("3\t-1")).toBeNull()
    expect(parseAheadBehind("")).toBeNull()
    expect(parseAheadBehind("a\tb")).toBeNull()
  })
})

describe("the ahead-of-base count", () => {
  test("republishes when only `ahead` changed", async () => {
    // The whole point of the chip: a committing worker leaves +N/−N at zero
    // and moves nothing else. If `sameWorktreeChanges` ignored `ahead` the
    // publish would be suppressed and the row would sit blank through the one
    // event that proves the attempt delivered something.
    const bus = new DaemonEventBus()
    const published: WorktreeChangesPayload[] = []
    bus.onPublish((event) => {
      if (event.channel === "worktree.changes") published.push(event.payload as WorktreeChangesPayload)
    })
    let ahead = 0
    const collector = new WorktreeChangesCollector({ listTasks: () => [task({ id: "a" })] }, bus, {
      cadence: FAST,
      publishDelayMs: 0,
      run: async () => ({ added: 0, deleted: 0, behind: 0, ahead }),
    })
    collector.tick()
    await settle()
    expect(published.at(-1)?.changes["/wt/a"]).toEqual({ added: 0, deleted: 0, behind: 0, ahead: 0 })

    ahead = 1
    collector.tick()
    await settle()
    expect(published.at(-1)?.changes["/wt/a"]).toEqual({ added: 0, deleted: 0, behind: 0, ahead: 1 })
    expect(published).toHaveLength(2)

    collector.tick()
    await settle()
    expect(published).toHaveLength(2)
  })
})

describe("a worktree whose git status fails", () => {
  test("is published as unreadable, not omitted, and never blocks the readable ones", async () => {
    // `harness`'s runner throws for any path without seeded counts — the same
    // shape a real EACCES `.git` or a moved admin dir produces.
    const { collector, published } = harness([task({ id: "ok" }), task({ id: "broken" })], {
      "/wt/ok": { added: 3, deleted: 1 },
    })
    collector.tick()
    await settle()

    const last = published.at(-1)
    expect(last?.changes["/wt/ok"]).toEqual({ added: 3, deleted: 1 })
    // The whole point. Before this, a failed run reached no callback at all,
    // so the path fell out of the map — and an absent key is indistinguishable
    // from "not collected", which every subscriber draws as a clean row.
    expect(last?.changes["/wt/broken"]).toBeUndefined()
    expect(last?.unreadable).toEqual(["/wt/broken"])
  })

  test("omits the field entirely when everything read cleanly", async () => {
    // Wire compatibility: the common payload stays byte-identical to what this
    // channel has always published, so an older client sees no new key.
    const { collector, published } = harness([task({ id: "ok" })], { "/wt/ok": { added: 1, deleted: 0 } })
    collector.tick()
    await settle()
    expect(published.at(-1)?.unreadable).toBeUndefined()
  })

  test("republishes when an unreadable worktree becomes readable again", async () => {
    const h = harness([task({ id: "a" })], {})
    h.collector.tick()
    await settle()
    expect(h.published.at(-1)?.unreadable).toEqual(["/wt/a"])

    h.counts["/wt/a"] = { added: 2, deleted: 0 }
    h.collector.tick()
    await settle()
    expect(h.published.at(-1)?.unreadable).toBeUndefined()
    expect(h.published.at(-1)?.changes["/wt/a"]).toEqual({ added: 2, deleted: 0 })
  })

  test("does NOT overwrite counts that once read cleanly", async () => {
    // Stale beats unknown once there is a real value to go stale from — the
    // same trade `prCheckChip` makes for a provider it could not reach. Only a
    // worktree that has NEVER read cleanly publishes as unreadable.
    const h = harness([task({ id: "a" })], { "/wt/a": { added: 4, deleted: 0 } })
    h.collector.tick()
    await settle()
    const before = h.published.length

    h.counts["/wt/a"] = undefined as unknown as WorktreeChanges
    h.collector.tick()
    await settle()
    expect(h.published.length).toBe(before)
    expect(h.published.at(-1)?.changes["/wt/a"]).toEqual({ added: 4, deleted: 0 })
    expect(h.published.at(-1)?.unreadable).toBeUndefined()
  })
})
