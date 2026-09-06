/**
 * The orphan predicate's branches, held against the shapes a live machine
 * cannot stage on demand — a group whose leader is still running, a live
 * session's group, our own group. Each row here is a way the sweep could kill
 * something it must not.
 */

import { spawn } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { defaultDaemonLogPath } from "@sma1lboy/kobe-daemon/daemon/paths"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { killOrphanGroups, orphanCandidates, orphanDoctorLines, parsePsRows } from "../../src/cli/doctor-orphans.ts"

const PS = [
  //  pid  ppid  pgid  etime         rss    command
  "  100     1   100   05-01:00:00   4096   /usr/libexec/some-daemon",
  "  200     1   150   04-22:42:56  25600   bun test test/render",
  "  300   250   150   04-22:42:56  25600   bun --coverage test/render",
  "  400     1   350   00:31:00     20480   node server.js",
  // 500's group is one `pty.list` still calls alive, and its leader row is
  // ABSENT — the window between a child dying and the host recording it. Only
  // the live-session clause spares this one.
  "  500     1   600   01:00:00      1024   sh -c worker",
  // 800's leader IS in the table, so the dead-leader clause spares it.
  "  800     1   850   01:00:00      1024   sh -c another worker",
  "  850   840   850   01:00:00      1024   /bin/sh -c trap '' HUP; worker",
  "  700     1   900   02:00:00      2048   my own shell's child",
].join("\n")

const rows = parsePsRows(PS)

describe("parsePsRows", () => {
  it("keeps a command containing spaces intact", () => {
    expect(rows.find((row) => row.pid === 200)).toEqual({
      pid: 200,
      ppid: 1,
      pgid: 150,
      etime: "04-22:42:56",
      rssKb: 25600,
      command: "bun test test/render",
    })
  })

  it("drops lines that are not a process row", () => {
    expect(parsePsRows("  PID  PPID\ngarbage\n")).toEqual([])
  })
})

describe("orphanCandidates", () => {
  const candidates = orphanCandidates(rows, 900, new Set([600]))
  const pids = candidates.map((row) => row.pid)

  it("takes a reparented process whose group leader is gone", () => {
    expect(pids).toContain(200)
    expect(pids).toContain(400)
  })

  it("spares a process whose parent is still alive", () => {
    // 300's parent (250) never died, so nothing about it is abandoned.
    expect(pids).not.toContain(300)
  })

  it("spares an ordinary daemon, which is its own group leader", () => {
    expect(pids).not.toContain(100)
  })

  it("spares a reparented process whose group the PTY host still calls live", () => {
    // The tab is on screen; the user owns what is in it. Load-bearing on its
    // own here — 600 has no row, so only `liveSessionPids` rules 500 out.
    expect(pids).not.toContain(500)
  })

  it("spares a reparented process whose group leader is still running", () => {
    expect(pids).not.toContain(800)
  })

  it("spares our own process group", () => {
    expect(pids).not.toContain(700)
  })

  it("returns nothing when every group still has a leader", () => {
    expect(
      orphanCandidates(
        rows.filter((row) => row.pgid === 850),
        -1,
        new Set(),
      ),
    ).toEqual([])
  })
})

describe("orphanDoctorLines", () => {
  it("says the sweep is a command to run, never something doctor did", () => {
    const lines = orphanDoctorLines(orphanCandidates(rows, 900, new Set([600])), null, "rove").join("\n")
    expect(lines).toContain("rove doctor --kill-orphans")
    expect(lines).toContain("bun test test/render")
  })

  it("reports an inspection failure instead of a clean bill of health", () => {
    expect(orphanDoctorLines([], "could not read the process table — ps exited 1", "rove")[0]).toContain(
      "could not read the process table",
    )
  })

  it("is a ✓ line when nothing is orphaned", () => {
    expect(orphanDoctorLines([], null, "rove")[0]).toContain("✓ none")
  })
})

describe("killOrphanGroups leaves a trace", () => {
  // This is the ONLY path in Rove that ends a hosted session's process tree
  // without going through the PTY host, so nothing else records it: the host
  // writes no exit record (it was never asked) and doctor's stdout is gone as
  // soon as the terminal scrolls. Someone asking later "who killed those two
  // shells?" could rule out every Rove path except this one, which left
  // nothing at all behind.
  let home: string
  const prevHome = process.env.ROVE_HOME_DIR

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "kobe-orphan-log-"))
    process.env.ROVE_HOME_DIR = home
    mkdirSync(join(defaultDaemonLogPath(home), ".."), { recursive: true })
  })

  afterEach(() => {
    if (prevHome === undefined) Reflect.deleteProperty(process.env, "ROVE_HOME_DIR")
    else process.env.ROVE_HOME_DIR = prevHome
    rmSync(home, { recursive: true, force: true })
  })

  it("writes one timestamped daemon.log line naming the pgid, signal, and who did it", async () => {
    // A real detached child so the kill is a real kill: `detached` makes the
    // child its own group leader, which is the shape the sweep signals.
    const child = spawn("sleep", ["30"], { detached: true, stdio: "ignore" })
    child.unref()
    const pgid = child.pid
    if (pgid === undefined) throw new Error("could not spawn a detached child")

    const result = await killOrphanGroups([
      { pid: pgid, ppid: 1, pgid, etime: "01:00:00", rssKb: 1024, command: "sleep 30" },
    ])
    expect(result.survivors).toEqual([])

    const log = readFileSync(defaultDaemonLogPath(home), "utf8")
    expect(log).toMatch(/^\[\d{4}-\d\d-\d\dT[\d:.]+Z\] daemon \[doctor-kill-orphans\]: SIGTERM process group \d+$/m)
    expect(log).toContain(`process group ${pgid}`)
  })
})
