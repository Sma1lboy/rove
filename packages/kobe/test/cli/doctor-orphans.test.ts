/**
 * The orphan predicate's branches, held against the shapes a live machine
 * cannot stage on demand — a group whose leader is still running, a live
 * session's group, our own group. Each row here is a way the sweep could kill
 * something it must not.
 */

import { describe, expect, it } from "vitest"
import { orphanCandidates, orphanDoctorLines, parsePsRows } from "../../src/cli/doctor-orphans.ts"

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
    expect(orphanDoctorLines([], "ps exited 1", "rove")[0]).toContain("could not inspect")
  })

  it("is a ✓ line when nothing is orphaned", () => {
    expect(orphanDoctorLines([], null, "rove")[0]).toContain("✓ none")
  })
})
