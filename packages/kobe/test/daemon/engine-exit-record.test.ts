/**
 * Engine-layer death records. Without them, engines killed by a provider
 * usage limit leave `pty-exits.json` with ZERO records, because every
 * wrapper shell survives its engine.
 *
 * Two halves, tested where each lives: the store must persist an engine
 * death with the wrapper's exit code scraped out of the tail, and the
 * activity observer must FIRE one exactly on the walk's vendor→no-engine
 * edge of a session that is still alive.
 */

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { startActivityObserver } from "@sma1lboy/kobe-daemon/daemon/activity-observer"
import {
  engineExitCodeFromTail,
  readPtyExitRecords,
  recordEngineExit,
  recordPtyExit,
} from "@sma1lboy/kobe-daemon/daemon/pty-exit-store"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

let dir: string
let path: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kobe-engine-exit-"))
  path = join(dir, "pty-exits.json")
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

// The real shape of a quota death: provider error, zsh's own kill notice,
// then the keepAlive wrapper's banner (ANSI-wrapped). 143 = 128 + SIGTERM.
const INCIDENT_TAIL =
  "Error: [provider.auth_error] 403 You_ve reached your 5-hour usage limit.\r\n" +
  "zsh: terminated  kimi -y\r\n" +
  "\x1b[33m  Engine exited (code 143). Check Settings\x1b[0m\r\n"

describe("engine exit code scrape", () => {
  it("reads the wrapper banner's code and null when absent", () => {
    expect(engineExitCodeFromTail(["  Engine exited (code 143). Check Settings"])).toBe(143)
    expect(engineExitCodeFromTail(["all quiet", "$ "])).toBeNull()
  })

  it("takes the LAST banner — a tab that restarted its engine twice", () => {
    expect(engineExitCodeFromTail(["Engine exited (code 1).", "Engine exited (code 143)."])).toBe(143)
  })
})

describe("engine death records", () => {
  it("persists the incident shape: code, vendor, tail, live parent", () => {
    recordEngineExit(
      { key: "t1::tab-1", vendor: "kimi", pid: 5150, at: "2026-08-30T12:00:00.000Z", tail: INCIDENT_TAIL },
      path,
    )
    const record = readPtyExitRecords(path)["t1::tab-1#engine"]
    expect(record).toMatchObject({
      key: "t1::tab-1",
      layer: "engine",
      vendor: "kimi",
      pid: 5150,
      code: 143,
      signal: null,
      parentAlive: true,
    })
    // The 403 line is why this record exists at all.
    expect(record?.tail.join("\n")).toContain("5-hour usage limit")
    // Tail is stored plain — no raw escapes leak into the record.
    expect(record?.tail.join("\n")).not.toContain("\x1b")
  })

  it("keeps both layers of one tab — an engine death is not a PTY death", () => {
    recordEngineExit({ key: "t1::tab-1", vendor: "kimi", pid: 1, at: "2026-08-30T12:00:00.000Z", tail: "" }, path)
    recordPtyExit(
      { key: "t1::tab-1", pid: 2, exit: { code: 1, signal: null, at: "2026-08-30T13:00:00.000Z" }, tail: "" },
      path,
    )
    const records = readPtyExitRecords(path)
    expect(records["t1::tab-1#engine"]?.layer).toBe("engine")
    expect(records["t1::tab-1"]?.layer).toBe("pty")
  })

  it("records a clean disappearance too (no banner ⇒ null code)", () => {
    recordEngineExit({ key: "t1::tab-1", vendor: "claude", pid: 9, at: "2026-08-30T12:00:00.000Z", tail: "$ " }, path)
    expect(readPtyExitRecords(path)["t1::tab-1#engine"]).toMatchObject({ code: null, vendor: "claude" })
  })
})

interface WalkFires {
  /** The vendor→no-engine EDGE — a death this observer watched happen. */
  readonly exits: Array<Record<string, unknown>>
  /** The BOOT case — a live session with no engine on the first walk, so
   *  there is no previous vendor and never will be one. */
  readonly absent: Array<Record<string, unknown>>
}

/** Drive the observer's walk with a steerable per-walk vendor table. */
function observeWalk(steps: readonly (string | null)[]): Promise<WalkFires> {
  const fired: Array<Record<string, unknown>> = []
  const absent: Array<Record<string, unknown>> = []
  let walk = 0
  const stop = startActivityObserver(
    { observeTab: () => "noop", close: () => {} } as never,
    {
      listSessions: () => Promise.resolve([{ key: "t1::tab-1", alive: true, pid: 777, title: "", totalBytes: 1 }]),
      foregroundEngines: (pids) => {
        const vendor = steps[Math.min(walk, steps.length - 1)] ?? null
        walk++
        // Engine pid deliberately differs from the session pid — a record
        // naming the surviving PTY instead of the dead engine is the bug.
        return Promise.resolve(new Map(pids.map((pid) => [pid, vendor ? { vendor, pid: 9001 } : null])))
      },
      titleTurnHint: () => null,
      onEngineExit: (info) => {
        fired.push({ ...info })
      },
      onEngineAbsentAtStart: (info) => {
        absent.push({ ...info })
      },
    },
    () => true,
    { pollMs: 5, walkEveryTicks: 1, log: () => {} },
  )
  return new Promise((resolve) => {
    setTimeout(
      () => {
        stop()
        resolve({ exits: fired, absent })
      },
      5 * steps.length + 80,
    )
  })
}

describe("observer engine-death edge", () => {
  it("fires once on vendor → no-engine, and not again while it stays gone", async () => {
    const { exits } = await observeWalk(["kimi", "kimi", null, null, null])
    expect(exits).toEqual([{ taskId: "t1", tabId: "tab-1", vendor: "kimi", pid: 9001 }])
  })

  it("stays silent for a session that never had an engine", async () => {
    expect((await observeWalk([null, null, null])).exits).toEqual([])
  })

  it("fires again when an engine is restarted and dies a second time", async () => {
    expect((await observeWalk(["kimi", null, "kimi", null, null])).exits).toHaveLength(2)
  })
})

/**
 * The boot case. Every track starts at `vendor: undefined`, so the edge above
 * can only report a death this daemon watched happen — and the registry is
 * in-memory by contract. A `rove daemon restart` therefore turned a dead
 * engine's tab back into `idle`, and an engine that died while the daemon was
 * DOWN was never recorded at all. Both need a fact only the first walk has:
 * this session was already live and there is no engine in it.
 */
describe("observer boot reconciliation", () => {
  it("reports a live, engine-free session on the first walk", async () => {
    const { absent, exits } = await observeWalk([null, null, null])
    expect(absent).toEqual([{ taskId: "t1", tabId: "tab-1" }])
    // It is NOT an observed death — nothing was watched dying.
    expect(exits).toEqual([])
  })

  it("reports it once, not on every later walk that also finds nothing", async () => {
    expect((await observeWalk([null, null, null, null, null])).absent).toHaveLength(1)
  })

  it("stays silent when the first walk finds an engine — including after it later dies", async () => {
    // A session that WAS walked with an engine has a real edge; routing it
    // through the boot path too would double-report the same death.
    const { absent, exits } = await observeWalk(["kimi", "kimi", null, null])
    expect(absent).toEqual([])
    expect(exits).toHaveLength(1)
  })
})
