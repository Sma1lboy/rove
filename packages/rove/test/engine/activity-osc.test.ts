import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DaemonActivityRegistry } from "@sma1lboy/rove-daemon/daemon/activity-registry"
import { AttentionInboxStore } from "@sma1lboy/rove-daemon/daemon/attention-inbox"
import { DaemonEventBus } from "@sma1lboy/rove-daemon/daemon/event-bus"
import { expect, it } from "vitest"
import { programStatusActivity } from "../../../rove-daemon/src/daemon/program-status-activity"
import type { ProgramStatusEvent } from "../../../rove-daemon/src/daemon/program-status-event"

it("retains same-millisecond transitions, deduplicates recovery, and protects newer hooks on clear", async () => {
  const bus = new DaemonEventBus()
  let now = 1000
  const activity = new DaemonActivityRegistry(bus, 60_000, () => now)
  const inbox = new AttentionInboxStore(
    join(await mkdtemp(join(tmpdir(), "rove-status-")), "inbox.json"),
    bus,
    () => now,
  )
  await inbox.init()
  const accept = programStatusActivity(activity, (id) => id === "task", inbox)
  const event = (revision: number, state: "working" | "blocked" | "done" | null): ProgramStatusEvent => ({
    key: "task::tab-1",
    generation: "one",
    revision,
    at: now,
    status: state === null ? null : { id: "", state, at: now, kind: "permission" },
  })
  const state = () => activity.replaySnapshot().find((s) => s.tabId === "tab-1")?.state
  try {
    await accept(event(1, "working"))
    await accept(event(2, "blocked"))
    expect(state()).toBe("permission_needed")
    expect(inbox.snapshot()[0]?.state).toBe("permission_needed")
    await accept(event(3, "working"))
    expect(inbox.snapshot()).toEqual([])
    await accept(event(4, "done"))
    expect(state()).toBe("turn_complete")
    await accept(event(2, "blocked"))
    expect(state()).toBe("turn_complete")
    await accept(event(5, null))
    expect(state()).toBeUndefined()
    expect(inbox.snapshot()).toEqual([])
    await accept(event(6, "blocked"))
    activity.report("task", "turn-start", undefined, "tab-1")
    await accept(event(7, null))
    expect(state()).toBe("running")
    now++
    await accept(event(8, "done"))
    expect(state()).toBe("turn_complete")
    const restarted = programStatusActivity(activity, () => true, inbox)
    await restarted({ ...event(9, "blocked"), at: now - 100 })
    expect(state()).toBe("turn_complete")
  } finally {
    activity.close()
  }
})

it("recovers done over observed idle, but a real hook's idle remains authoritative", async () => {
  let now = 2000
  const activity = new DaemonActivityRegistry(new DaemonEventBus(), 60_000, () => now)
  const accept = programStatusActivity(activity, () => true)
  const event: ProgramStatusEvent = {
    key: "task::tab-1",
    generation: "one",
    revision: 1,
    at: 1000,
    status: { id: "", state: "done", at: 1000 },
  }
  try {
    activity.observeTab("task", "tab-1", "rest")
    await accept(event)
    expect(activity.replaySnapshot().find((s) => s.tabId)?.state).toBe("turn_complete")
    now++
    activity.report("task", "turn-interrupted", undefined, "tab-1")
    await accept({ ...event, revision: 2 })
    expect(activity.replaySnapshot().find((s) => s.tabId)).toBeUndefined()
    expect(activity.hasHookSince("task", "tab-1", 1000)).toBe(true)
    activity.clearTab("task", "tab-1")
    expect(activity.hasHookSince("task", "tab-1", 1000)).toBe(false)
    now = 3000
    await accept({ ...event, revision: 3, at: now, status: { id: "", state: "idle", at: now } })
    now++
    activity.report("task", "turn-interrupted", undefined, "tab-1")
    await accept({ ...event, revision: 4, at: now - 1 })
    expect(activity.replaySnapshot().find((s) => s.tabId)).toBeUndefined()
  } finally {
    activity.close()
  }
})

it("never revives a dead engine from its older PTY status snapshot", async () => {
  const activity = new DaemonActivityRegistry(new DaemonEventBus(), 60_000, () => 3000)
  const accept = programStatusActivity(activity, () => true)
  const snapshot: ProgramStatusEvent = {
    key: "task::tab-1",
    generation: "one",
    revision: 1,
    at: 1000,
    status: { id: "", state: "working", at: 1000 },
  }
  try {
    activity.recordEngineDeath("task", "tab-1", { code: 1 }, 2000)
    await accept(snapshot)
    expect(activity.replaySnapshot().find((s) => s.tabId)?.state).toBe("dead")
    await accept({ ...snapshot, generation: "two", at: 2500, status: { id: "", state: "working", at: 2500 } })
    expect(activity.replaySnapshot().find((s) => s.tabId)?.state).toBe("running")
  } finally {
    activity.close()
  }
})

it("uses the original signal time when a death record arrives after a replay", async () => {
  const activity = new DaemonActivityRegistry(new DaemonEventBus(), 60_000, () => 3000)
  const accept = programStatusActivity(activity, () => true)
  try {
    await accept({
      key: "task::tab-1",
      generation: "one",
      revision: 1,
      at: 1000,
      status: { id: "", state: "working", at: 1000 },
    })
    activity.recordEngineDeath("task", "tab-1", { code: 1 }, 2000)
    expect(activity.replaySnapshot().find((s) => s.tabId)?.state).toBe("dead")
  } finally {
    activity.close()
  }
})
