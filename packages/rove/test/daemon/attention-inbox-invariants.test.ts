import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AttentionInboxStore } from "@sma1lboy/rove-daemon/daemon/attention-inbox"
import { DaemonEventBus } from "@sma1lboy/rove-daemon/daemon/event-bus"
import { afterEach, describe, expect, it } from "vitest"

describe("attention inbox store invariants", () => {
  let dir: string | null = null

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
    dir = null
  })

  it("stores and indexes a new episode under its required tab identity", async () => {
    dir = await mkdtemp(join(tmpdir(), "rove-attention-inbox-invariants-"))
    const store = new AttentionInboxStore(join(dir, "attention-inbox.json"), new DaemonEventBus(), () => 100)
    await store.init()

    await store.record("task-1", "turn-complete", undefined, "tab-1")

    expect(store.snapshot()).toEqual([
      expect.objectContaining({ taskId: "task-1", tabId: "tab-1", state: "turn_complete", at: 100 }),
    ])
    expect(await store.markRead("task-1", "tab-1", 100)).toBe(true)
  })

  // A missing tab identity records at TASK level (an engine typed into a bare
  // shell inherits no ROVE_TAB_ID). An EMPTY string
  // is not a tab either: normalize it to null rather than keying an episode
  // on `""`.
  // Once per thaw: an acked restore stays gone across a daemon restart; the next reboot's thaw raises it again.
  it("raises a restored session once per thaw, across daemon restarts", async () => {
    dir = await mkdtemp(join(tmpdir(), "rove-attention-inbox-invariants-"))
    const path = join(dir, "attention-inbox.json")
    const thaw = [{ taskId: "task-1", tabId: "tab-1", generation: "g1" }]
    const store = new AttentionInboxStore(path, new DaemonEventBus(), () => 100)
    await store.init()
    await store.recordRestored(thaw)
    expect(store.snapshot()).toEqual([expect.objectContaining({ taskId: "task-1", state: "restored" })])
    await store.deleteEpisode("task-1", "tab-1")

    const restarted = new AttentionInboxStore(path, new DaemonEventBus(), () => 200)
    await restarted.init()
    await restarted.recordRestored(thaw)
    expect(restarted.snapshot()).toEqual([])
    await restarted.recordRestored([{ ...thaw[0]!, generation: "g2" }])
    expect(restarted.snapshot()).toEqual([expect.objectContaining({ state: "restored", at: 200 })])
  })

  it("normalizes an empty tab identity to a task-level episode", async () => {
    dir = await mkdtemp(join(tmpdir(), "rove-attention-inbox-invariants-"))
    const store = new AttentionInboxStore(join(dir, "attention-inbox.json"), new DaemonEventBus())
    await store.init()

    await store.record("task-1", "turn-complete", undefined, "")
    expect(store.snapshot().map((episode) => episode.tabId)).toEqual([null])

    // The same task's tab-level episode is a DIFFERENT queue entry.
    await store.record("task-1", "turn-complete", undefined, "tab-1")
    expect(new Set(store.snapshot().map((episode) => episode.tabId))).toEqual(new Set([null, "tab-1"]))
  })

  it("does not delete a replacement episode through a stale dismiss action", async () => {
    let now = 100
    dir = await mkdtemp(join(tmpdir(), "rove-attention-inbox-invariants-"))
    const store = new AttentionInboxStore(join(dir, "attention-inbox.json"), new DaemonEventBus(), () => now)
    await store.init()
    await store.record("task-1", "turn-complete", undefined, "tab-1")

    now = 200
    await store.record("task-1", "turn-failed", { failure: "other" }, "tab-1")

    expect(await store.deleteEpisode("task-1", "tab-1", 100)).toBe(false)
    expect(store.snapshot()).toEqual([expect.objectContaining({ taskId: "task-1", tabId: "tab-1", at: 200 })])
    expect(await store.deleteEpisode("task-1", "tab-1", 200)).toBe(true)
  })
})
