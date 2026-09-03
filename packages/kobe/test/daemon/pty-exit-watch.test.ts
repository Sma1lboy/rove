import { mkdtempSync, rmSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DaemonActivityRegistry, type EngineStatePayload } from "@sma1lboy/kobe-daemon/daemon/activity-registry"
import { DaemonEventBus } from "@sma1lboy/kobe-daemon/daemon/event-bus"
import { recordEngineExit, recordPtyExit } from "@sma1lboy/kobe-daemon/daemon/pty-exit-store"
import { startPtyExitWatch } from "@sma1lboy/kobe-daemon/daemon/pty-exit-watch"
import { afterEach, describe, expect, it } from "vitest"

const dirs: string[] = []
function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "kobe-pty-exit-watch-"))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

async function waitFor(predicate: () => boolean, ms = 5_000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > ms) throw new Error("timed out")
    await new Promise((r) => setTimeout(r, 25))
  }
}

function exitInfo(key: string, at: string) {
  return { key, pid: 42, exit: { code: 1, signal: null, at }, tail: "boom\n" }
}

describe("startPtyExitWatch", () => {
  it("fires session.exited for NEW records only, with parsed task/tab", async () => {
    const path = join(tmp(), "pty-exits.json")
    // Pre-existing corpse — baseline, must not fire.
    recordPtyExit(exitInfo("old-task::tab-1", "2026-01-01T00:00:00.000Z"), path)

    const reports: { kind: string; taskId?: string; detail?: Record<string, unknown> }[] = []
    const stop = startPtyExitWatch({
      path,
      plugins: () => ({ handleUiReport: (r) => reports.push(r) }),
    })
    try {
      recordPtyExit(exitInfo("task-9::tab-3", "2026-01-02T00:00:00.000Z"), path)
      await waitFor(() => reports.length > 0)
      expect(reports).toEqual([
        {
          kind: "session.exited",
          taskId: "task-9",
          detail: {
            key: "task-9::tab-3",
            tabId: "tab-3",
            pid: 42,
            code: 1,
            signal: null,
            exitedAt: "2026-01-02T00:00:00.000Z",
            tail: ["boom"],
          },
        },
      ])
      // Rewriting the SAME record (same key+at) must not re-fire.
      recordPtyExit(exitInfo("task-9::tab-3", "2026-01-02T00:00:00.000Z"), path)
      await new Promise((r) => setTimeout(r, 400))
      expect(reports.length).toBe(1)
    } finally {
      stop()
    }
  })
})

/**
 * The WIRE, end to end: a real exit record on disk → the watcher → the real
 * activity registry → a published `engine-state`.
 *
 * The mutation this is built to catch is a broken CONNECTION, not a broken
 * leaf: dropping `activity` from the watch options, dropping the
 * `publishDeath` call in the sweep, or reverting `recordEngineDeath` all turn
 * this red. A test that only checked "the record parses" would stay green
 * through every one of them — which is exactly how the death reached
 * `pty-exits.json` and no UI for as long as it did.
 */
describe("startPtyExitWatch → activity registry", () => {
  it("publishes a `dead` engine-state carrying the exit code and last error line", async () => {
    const path = join(tmp(), "pty-exits.json")
    const bus = new DaemonEventBus()
    const published: EngineStatePayload[] = []
    bus.onPublish((event) => {
      if (event.channel === "engine-state") published.push(event.payload as EngineStatePayload)
    })
    const activity = new DaemonActivityRegistry(bus)
    const stop = startPtyExitWatch({
      path,
      plugins: () => ({ handleUiReport: () => {} }),
      activity,
    })
    try {
      // The quota-death shape: SIGTERM'd engine, 403 quota text in the tail.
      recordPtyExit(
        {
          key: "task-1::tab-1",
          pid: 900,
          exit: { code: 143, signal: null, at: "2026-08-30T12:00:00.000Z" },
          tail: "Error: [provider.auth_error] 403 You've reached your 5-hour usage limit.\nzsh: terminated kimi -y\n",
        },
        path,
      )
      await waitFor(() => published.length > 0)
      const payload = published.at(-1)
      expect(payload?.state).toBe("dead")
      expect(payload?.tabId).toBe("tab-1")
      expect(payload?.detail?.exit?.code).toBe(143)
      // The error text was always on disk; this is the assertion that it now
      // travels with the state instead of dying in the file.
      expect(payload?.detail?.exit?.lastLine).toBe("zsh: terminated kimi -y")
    } finally {
      stop()
      activity.close()
    }
  })

  it("does not let an OLD death bury a newer live turn in the same tab", async () => {
    const path = join(tmp(), "pty-exits.json")
    const bus = new DaemonEventBus()
    const activity = new DaemonActivityRegistry(bus)
    const stop = startPtyExitWatch({
      path,
      plugins: () => ({ handleUiReport: () => {} }),
      activity,
    })
    try {
      // A live turn reported NOW; the record on disk predates it (a corpse
      // from the previous session in this same tab).
      activity.report("task-1", "turn-start", undefined, "tab-1")
      recordPtyExit(
        {
          key: "task-1::tab-1",
          pid: 1,
          exit: { code: 1, signal: null, at: "2020-01-01T00:00:00.000Z" },
          tail: "old\n",
        },
        path,
      )
      await waitFor(() => Object.keys(activity.debugSnapshot().tabs).length > 0)
      expect(activity.debugSnapshot().tabs["task-1"]?.["tab-1"]?.state).toBe("running")
    } finally {
      stop()
      activity.close()
    }
  })
})

/**
 * The server must actually HAND the watcher its two consumers.
 *
 * The behavioural tests above construct the watcher themselves, so they stay
 * green if `server.ts` stops passing `activity`/`inbox` — the death would
 * then reach `pty-exits.json`, the watcher would parse it perfectly, and the
 * UI would still see nothing. That disconnect is the entire bug this work
 * fixes, so it gets its own assertion against the wiring itself.
 */
describe("server wiring", () => {
  it("passes both the activity registry and the inbox to startPtyExitWatch", async () => {
    const src = await readFile(new URL("../../../kobe-daemon/src/daemon/server.ts", import.meta.url), "utf8")
    const call = /startPtyExitWatch\(\{([\s\S]*?)\n\s*\}\)/.exec(src)?.[1]
    expect(call, "startPtyExitWatch call not found in server.ts").toBeDefined()
    expect(call).toMatch(/^\s*activity,\s*$/m)
    expect(call).toMatch(/^\s*inbox,\s*$/m)
  })
})

describe("startPtyExitWatch with engine-layer records", () => {
  it("fires an engine death exactly once, however many sweeps follow", async () => {
    // `recordEngineExit` writes under `<key>#engine` while the record inside
    // keeps the bare session key. Keying `seen` by `record.key` meant the
    // prune test (`key in records`) missed — deleting the entry on the same
    // sweep that created it — so every later sweep re-fired the same death:
    // duplicate `session.exited` plugin events, and an Attention Inbox episode
    // the user had already read popping back to unread.
    const path = join(tmp(), "pty-exits.json")
    const reports: { detail?: Record<string, unknown> }[] = []
    const stop = startPtyExitWatch({ path, plugins: () => ({ handleUiReport: (r) => reports.push(r) }) })
    try {
      recordEngineExit(
        { key: "task-1::tab-1", pid: 7, at: "2026-02-01T00:00:00.000Z", tail: "quota exhausted\n", vendor: "claude" },
        path,
      )
      await waitFor(() => reports.length > 0)
      expect(reports).toHaveLength(1)

      // Any other write re-sweeps the whole file. The engine record is not new.
      recordPtyExit(exitInfo("task-2::tab-9", "2026-02-01T00:01:00.000Z"), path)
      await waitFor(() => reports.length > 1)
      await new Promise((r) => setTimeout(r, 400))

      expect(reports.filter((r) => r.detail?.key === "task-1::tab-1")).toHaveLength(1)
    } finally {
      stop()
    }
  })
})
