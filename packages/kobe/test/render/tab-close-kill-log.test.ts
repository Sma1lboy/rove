/**
 * Closing a tab whose PTY this process holds no handle for must leave a
 * TRACE when the host is never told to kill it.
 *
 * The stakes are not cosmetic. A kill that lands reaches `freeze.drop` and
 * the record is gone; a kill that never happens leaves the freeze record on
 * disk, and the next pty host inside the TTL thaws it into a restored
 * session — the tab the user closed comes back, engine and all. That is the
 * one outcome `docs/SESSIONS.md` promises cannot happen, so the miss has to
 * be discoverable after the fact rather than swallowed by a bare `catch {}`.
 *
 * Lives in the bun track: the close module reaches `@opentui/react`
 * transitively, which vitest cannot resolve.
 *
 * This pins the no-client branch, which is the reachable one in-process:
 * `killHostedSession` deliberately refuses to DIAL the host (dialing would
 * pin a shared client on a tab close), so with no connection already cached
 * there is nothing to send the kill over.
 */

import { mkdtempSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, expect, it } from "bun:test"

let home: string
let releaseClosedTabPtys: typeof import("../../src/tui-react/workspace/terminal-tabs-close.ts").releaseClosedTabPtys
const saved: Record<string, string | undefined> = {}

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "rove-killlog-"))
  // ROVE_* wins over KOBE_* (compat-env precedence), so an inherited
  // ROVE_HOME_DIR would silently redirect the log to the real home.
  for (const key of ["ROVE_HOME_DIR", "KOBE_HOME_DIR"]) saved[key] = process.env[key]
  process.env.ROVE_HOME_DIR = home
  process.env.KOBE_HOME_DIR = home
  // Imported here, not at top level: the module pulls in the PTY registry
  // and the daemon client, which costs seconds on a loaded machine and would
  // otherwise be charged to the test's own timeout.
  ;({ releaseClosedTabPtys } = await import("../../src/tui-react/workspace/terminal-tabs-close.ts"))
})

afterAll(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

it("a tab close that cannot reach the host records the missed kill", async () => {
  // No local handle for this key and no shared pty client in a test process:
  // both conditions of the branch under test, without stubbing either.
  releaseClosedTabPtys("task-kill-log", undefined, "tab-7")

  const logPath = join(home, ".rove", "client.log")
  // The write is deliberately fire-and-forget (`appendFile`, never Sync), so
  // poll rather than assume it has landed by the time the call returns.
  let text = ""
  for (let i = 0; i < 50 && !text.includes("pty.kill"); i += 1) {
    await new Promise((r) => setTimeout(r, 20))
    text = await readFile(logPath, "utf8").catch(() => "")
  }
  expect(text).toContain("pty.kill skipped")
  // The key has to be in the line — a trace that cannot name the session it
  // failed to kill does not let anyone find the leaked freeze record.
  expect(text).toContain("task-kill-log")
})
