/**
 * A migrated child's conversation is a PTY keyed under its parent. Observed
 * activity, OSC program status and exit records all name that PTY by its key,
 * so each must be handed to the child; the parent's own tabs stay as they were.
 */

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type ActivityObserverIo, startActivityObserver } from "@sma1lboy/rove-daemon/daemon/activity-observer"
import { DaemonActivityRegistry } from "@sma1lboy/rove-daemon/daemon/activity-registry"
import { resolvePtyOwner } from "@sma1lboy/rove-daemon/daemon/cwd-task"
import { DaemonEventBus } from "@sma1lboy/rove-daemon/daemon/event-bus"
import { recordPtyExit } from "@sma1lboy/rove-daemon/daemon/pty-exit-store"
import { startPtyExitWatch } from "@sma1lboy/rove-daemon/daemon/pty-exit-watch"
import { afterEach, describe, expect, it, vi } from "vitest"
import { programStatusActivity } from "../../../rove-daemon/src/daemon/program-status-activity.ts"

const tasks = [
  { id: "parent" },
  { id: "child", sharesWorkspaceOf: "parent", ptyAlias: { taskId: "parent", tabId: "tab-2" } },
]
const ownerOf = (taskId: string, tabId: string): string => resolvePtyOwner(tasks, taskId, tabId)

function rig() {
  const bus = new DaemonEventBus()
  const activity = new DaemonActivityRegistry(bus)
  const events: Array<{ taskId: string; tabId?: string; state: string }> = []
  bus.onPublish((event) => {
    if (event.channel === "engine-state") events.push(event.payload as (typeof events)[number])
  })
  return {
    activity,
    of: (taskId: string, tabId: string) => events.filter((e) => e.taskId === taskId && e.tabId === tabId),
  }
}

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("a migrated child owns its parent-keyed PTY", () => {
  it("observes that PTY's activity as the child's and reports its engine exit under the child, with the real key", async () => {
    const { activity, of } = rig()
    const sessions = [
      { key: "parent::tab-1", alive: true, pid: 1, title: "working", totalBytes: 1 },
      { key: "parent::tab-2", alive: true, pid: 2, title: "working", totalBytes: 1 },
    ]
    let walks = 0
    const exits: unknown[] = []
    const io: ActivityObserverIo = {
      listSessions: async () => sessions,
      // The second conversation's engine is gone from the third walk on.
      foregroundEngines: async (pids) =>
        new Map(pids.map((pid) => [pid, pid === 2 && walks >= 2 ? null : { vendor: "claude", pid: 100 + pid }])),
      titleTurnHint: () => {
        walks++
        return "working"
      },
      onEngineExit: (info) => {
        exits.push(info)
      },
    }
    const stop = startActivityObserver(activity, io, () => true, { pollMs: 5, walkEveryTicks: 1, ownerOf })
    await vi.waitFor(() => expect(exits.length).toBeGreaterThan(0), { timeout: 5_000 })
    await stop()

    expect(exits[0]).toEqual({ taskId: "child", tabId: "tab-2", key: "parent::tab-2", vendor: "claude", pid: 102 })
    expect(of("child", "tab-2").length).toBeGreaterThan(0)
    expect(of("parent", "tab-1").length).toBeGreaterThan(0)
    expect(of("parent", "tab-2")).toEqual([])
  })

  it("badges that PTY's death on the child and tells plugins it was the child's; the parent's own tab still dies as the parent's", async () => {
    const { activity, of } = rig()
    const path = join(mkdtempSync(join(tmpdir(), "rove-alias-exit-")), "pty-exits.json")
    dirs.push(join(path, ".."))
    const reports: Array<{ taskId?: string; detail?: Record<string, unknown> }> = []
    const stop = startPtyExitWatch({
      path,
      plugins: () => ({ handleUiReport: (r) => reports.push(r) }),
      activity,
      ownerOf,
    })
    try {
      const death = (key: string, at: string) =>
        recordPtyExit({ key, pid: 42, exit: { code: 1, signal: null, at }, tail: "boom\n" }, path)
      death("parent::tab-2", "2026-01-02T00:00:00.000Z")
      death("parent::tab-1", "2026-01-02T00:00:01.000Z")
      await vi.waitFor(() => expect(reports).toHaveLength(2), { timeout: 5_000 })

      // The store's record order is not the death order, so compare as a set.
      expect(reports.map((r) => [r.taskId, r.detail?.key])).toEqual(
        expect.arrayContaining([
          ["child", "parent::tab-2"],
          ["parent", "parent::tab-1"],
        ]),
      )
      expect(of("child", "tab-2").map((e) => e.state)).toContain("dead")
      expect(of("parent", "tab-1").map((e) => e.state)).toContain("dead")
      expect(of("parent", "tab-2")).toEqual([])
    } finally {
      stop()
    }
  })

  it("takes the PTY's OSC program status for the child, even after the parent task is gone", async () => {
    const { activity, of } = rig()
    // Only the child exists: the parent was deleted and the child promoted.
    const accept = programStatusActivity(activity, (id) => id === "child", undefined, undefined, ownerOf)

    await accept({
      key: "parent::tab-2",
      generation: "g",
      revision: 1,
      at: Date.now(),
      status: { id: "", state: "working", at: Date.now() },
    })

    expect(of("child", "tab-2").map((e) => e.state)).toContain("running")
    expect(of("parent", "tab-2")).toEqual([])
  })
})
