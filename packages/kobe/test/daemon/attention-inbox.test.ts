import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AttentionInboxStore, MAX_EPISODES } from "@sma1lboy/kobe-daemon/daemon/attention-inbox"
import { DaemonEventBus } from "@sma1lboy/kobe-daemon/daemon/event-bus"
import { afterEach, describe, expect, it } from "vitest"

describe("daemon attention inbox", () => {
  let dir: string | null = null

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
    dir = null
  })

  async function create(now: number | (() => number) = 100): Promise<{
    store: AttentionInboxStore
    path: string
    bus: DaemonEventBus
  }> {
    dir = await mkdtemp(join(tmpdir(), "kobe-attention-inbox-"))
    const path = join(dir, "attention-inbox.json")
    const bus = new DaemonEventBus()
    const store = new AttentionInboxStore(path, bus, () => (typeof now === "function" ? now() : now))
    await store.init()
    return { store, path, bus }
  }

  /**
   * Seed `count` already-persisted episodes (task-0 … task-N, ascending `at`)
   * straight into the store file, then load them with one `init()`.
   *
   * Driving the seed through `record()` instead costs one whole-file rewrite
   * per episode — 510 rewrites of a file growing to 66KB, ~17.7MB of I/O.
   * That fits vitest's 5s budget on a dev Mac (~160ms) and blew it on a
   * loaded CI runner (v0.9.72 attempt 2: 5018ms and 5248ms). The timeout then
   * abandoned the loop still mid-write, so `afterEach`'s rm hit ENOTEMPTY on a
   * directory the orphaned loop was still writing into — one defect, two
   * symptoms. The prune under test lives in `commit()`, which only the
   * records made AFTER the seed reach, so nothing is lost by seeding cheaply.
   */
  async function seed(count: number, firstAt: number): Promise<string> {
    dir = await mkdtemp(join(tmpdir(), "kobe-attention-inbox-"))
    const path = join(dir, "attention-inbox.json")
    const items = Array.from({ length: count }, (_, i) => ({
      taskId: `task-${i}`,
      tabId: "tab-1",
      state: "turn_complete",
      unread: true,
      at: firstAt + i,
    }))
    await writeFile(path, JSON.stringify({ version: 1, items }), "utf8")
    return path
  }

  it("persists attention episodes and replays the full snapshot", async () => {
    const { store, path, bus } = await create(123)
    const snapshots: unknown[] = []
    bus.onPublish((event) => {
      if (event.channel === "attention.inbox") snapshots.push(event.payload)
    })

    await store.record("task-1", "turn-complete", undefined, "tab-2")

    expect(store.snapshot()).toEqual([
      { taskId: "task-1", tabId: "tab-2", state: "turn_complete", unread: true, at: 123 },
    ])
    expect(snapshots.at(-1)).toEqual({ items: store.snapshot() })
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ version: 1, items: store.snapshot() })

    const reloaded = new AttentionInboxStore(path, new DaemonEventBus(), () => 999)
    await reloaded.init()
    expect(reloaded.snapshot()).toEqual(store.snapshot())
  })

  it("removes only on a newer turn-start for the same task and tab", async () => {
    const { store } = await create()
    await store.record("task-1", "awaiting-input", { waiting: "permission" }, "tab-1")

    await store.record("task-1", "session-end", undefined, "tab-1")
    await store.record("task-1", "turn-start", undefined, "tab-2")
    expect(store.snapshot()).toHaveLength(1)

    await store.record("task-1", "turn-start", undefined, "tab-1")
    expect(store.snapshot()).toEqual([])
  })

  it("manual deletion dismisses one episode but a later episode returns", async () => {
    const { store } = await create()
    await store.record("task-1", "turn-failed", { failure: "other", note: "boom" }, "tab-1")

    expect(await store.deleteEpisode("task-1", "tab-1")).toBe(true)
    expect(store.snapshot()).toEqual([])
    expect(await store.deleteEpisode("task-1", "tab-1")).toBe(false)

    await store.record("task-1", "turn-complete", undefined, "tab-1")
    expect(store.snapshot()).toEqual([
      { taskId: "task-1", tabId: "tab-1", state: "turn_complete", unread: true, at: 100 },
    ])
  })

  it("can delete only the deferred lane while preserving task activity", async () => {
    let now = 100
    const { store } = await create(() => now)
    await store.record("task-1", "awaiting-input", { waiting: "permission" }, "tab-1")
    now = 200
    await store.recordPromptDeferred("task-1", "tab-1", "deferred-1", "composer-not-empty")

    expect(await store.deleteEpisode("task-1", "tab-1", 200, "prompt_deferred")).toBe(true)
    expect(store.snapshot()).toEqual([
      {
        taskId: "task-1",
        tabId: "tab-1",
        state: "permission_needed",
        detail: { waiting: "permission" },
        unread: true,
        at: 100,
      },
    ])
  })

  it("resolves an episode on open and ignores a stale open after a replacement", async () => {
    // Queue-drain model (owner 2026-07-16): opening REMOVES the episode
    // (markRead is a legacy alias for delete); a fresh event re-records at
    // the latest position, and a stale open (old `at`) must not eat it.
    let now = 100
    const { store, path } = await create(() => now)
    await store.record("task-1", "turn-complete", undefined, "tab-1")

    expect(await store.markRead("task-1", "tab-1", 100)).toBe(true)
    expect(store.snapshot()).toHaveLength(0)

    now = 200
    await store.record("task-1", "turn-failed", { failure: "other" }, "tab-1")
    expect(await store.markRead("task-1", "tab-1", 100)).toBe(false)
    expect(store.snapshot()[0]).toMatchObject({ at: 200 })

    const reloaded = new AttentionInboxStore(path, new DaemonEventBus())
    await reloaded.init()
    expect(reloaded.snapshot()[0]).toMatchObject({ at: 200 })
  })

  it("replaces a stale episode with the fresh one at the latest position", async () => {
    let now = 100
    const { store } = await create(() => now)
    await store.record("task-1", "turn-complete", undefined, "tab-1")
    now = 150
    await store.record("task-2", "turn-complete", undefined, "tab-1")

    // A fresh event on task-1/tab-1 replaces the old episode — dedupe keeps
    // ONE pending entry per task+tab and re-stamps it to the queue tail.
    now = 200
    await store.record("task-1", "awaiting-input", { waiting: "permission" }, "tab-1")
    const snapshot = store.snapshot()
    expect(snapshot).toHaveLength(2)
    expect(snapshot.map((item) => [item.taskId, item.at])).toEqual([
      ["task-2", 150],
      ["task-1", 200],
    ])
    expect(snapshot[1]).toMatchObject({ state: "permission_needed" })
  })

  it("treats pre-unread snapshots as unread", async () => {
    dir = await mkdtemp(join(tmpdir(), "kobe-attention-inbox-legacy-"))
    const path = join(dir, "attention-inbox.json")
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        items: [{ taskId: "task-1", tabId: null, state: "turn_complete", at: 50 }],
      }),
      "utf8",
    )
    const store = new AttentionInboxStore(path, new DaemonEventBus())
    await store.init()
    expect(store.snapshot()[0]?.unread).toBe(true)
  })

  it("keeps closed-tab episodes but cascades an explicit task deletion", async () => {
    const { store } = await create()
    await store.record("task-1", "turn-complete", undefined, "tab-1")
    await store.record("task-1", "session-end", undefined, "tab-1")
    await store.record("task-2", "turn-complete", undefined, "tab-1")

    await store.deleteTask("task-1")

    expect(store.snapshot().map((item) => item.taskId)).toEqual(["task-2"])
  })

  it("prunes the oldest episodes past the retention cap", async () => {
    // MAX_EPISODES + 10 distinct episodes, oldest first — the ten oldest
    // must fall off the tail-ward end and stay off after a reload. Without
    // the cap these would all persist: episodes of forgotten tasks leave
    // only on visit / turn-start / hard-delete, so this queue used to grow
    // without bound (one whole-file rewrite per recorded episode).
    // The first MAX_EPISODES are seeded (see `seed`); the ten that cross the
    // cap are recorded for real, so each one runs the prune in `commit()`.
    const path = await seed(MAX_EPISODES, 1000)
    let now = 1000 + MAX_EPISODES
    const store = new AttentionInboxStore(path, new DaemonEventBus(), () => now)
    await store.init()
    for (let i = MAX_EPISODES; i < MAX_EPISODES + 10; i++) {
      await store.record(`task-${i}`, "turn-complete", undefined, "tab-1")
      now += 1
    }
    const snapshot = store.snapshot()
    expect(snapshot).toHaveLength(MAX_EPISODES)
    expect(snapshot[0]).toMatchObject({ taskId: "task-10" })
    expect(snapshot.at(-1)).toMatchObject({ taskId: `task-${MAX_EPISODES + 9}` })

    const reloaded = new AttentionInboxStore(path, new DaemonEventBus())
    await reloaded.init()
    expect(reloaded.snapshot()).toHaveLength(MAX_EPISODES)
    expect(reloaded.snapshot()[0]).toMatchObject({ taskId: "task-10" })
  })

  it("a fresh episode on a capped task re-stamps it to the tail, not past the cap", async () => {
    const path = await seed(MAX_EPISODES, 1000)
    const store = new AttentionInboxStore(path, new DaemonEventBus(), () => 1000 + MAX_EPISODES)
    await store.init()
    // Re-recording a task already under the cap REPLACES its episode (dedupe
    // rule) — nothing is pruned yet, and the re-stamped episode sits at the
    // newest slot.
    await store.record("task-0", "awaiting-input", { waiting: "permission" }, "tab-1")
    let snapshot = store.snapshot()
    expect(snapshot).toHaveLength(MAX_EPISODES)
    expect(snapshot.at(-1)).toMatchObject({ taskId: "task-0", state: "permission_needed" })

    // The next NEW episode is the 501st — the cap prunes the OLDEST, which
    // is task-1 (task-0 just re-stamped itself out of the danger slot).
    await store.record("task-501", "turn-complete", undefined, "tab-1")
    snapshot = store.snapshot()
    expect(snapshot).toHaveLength(MAX_EPISODES)
    expect(snapshot.some((item) => item.taskId === "task-1")).toBe(false)
    expect(snapshot.at(-1)).toMatchObject({ taskId: "task-501" })
  })

  it("classifies waiting, rate limits, billing failures, and other failures", async () => {
    const { store } = await create()
    await store.record("task-1", "awaiting-input", { waiting: "input" }, "tab-1")
    await store.record("task-1", "turn-failed", { failure: "rate_limit" }, "tab-2")
    await store.record("task-1", "turn-failed", { failure: "billing" }, "tab-3")
    await store.record("task-1", "turn-failed", { failure: "other" }, "tab-4")

    expect(Object.fromEntries(store.snapshot().map((item) => [item.tabId, item.state]))).toEqual({
      "tab-1": "permission_needed",
      "tab-2": "rate_limited",
      "tab-3": "error",
      "tab-4": "error",
    })
  })

  it("boots with an empty Inbox when the persisted JSON is corrupt", async () => {
    dir = await mkdtemp(join(tmpdir(), "kobe-attention-inbox-corrupt-"))
    const path = join(dir, "attention-inbox.json")
    await writeFile(path, "{not-json", "utf8")
    const bus = new DaemonEventBus()
    const store = new AttentionInboxStore(path, bus)

    await expect(store.init()).resolves.toBeUndefined()
    expect(store.snapshot()).toEqual([])
    expect(bus.snapshot()).toContainEqual({ channel: "attention.inbox", payload: { items: [] } })
  })

  it("keeps memory unchanged when an atomic write fails", async () => {
    dir = await mkdtemp(join(tmpdir(), "kobe-attention-inbox-blocked-"))
    const blocker = join(dir, "not-a-directory")
    await writeFile(blocker, "blocked", "utf8")
    const store = new AttentionInboxStore(join(blocker, "attention-inbox.json"), new DaemonEventBus())
    await store.init()

    await expect(store.record("task-1", "turn-complete", undefined, "tab-1")).rejects.toThrow()
    expect(store.snapshot()).toEqual([])
  })

  it("keeps task deletion live when Inbox cleanup fails", async () => {
    const { store } = await create()
    store.deleteTask = async () => {
      throw new Error("disk full")
    }

    await expect(store.deleteTaskBestEffort("task-1")).resolves.toBeUndefined()
  })
})
