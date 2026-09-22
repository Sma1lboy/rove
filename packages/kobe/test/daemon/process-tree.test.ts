import { msysDescendantWinpids, msysPsFor, parseMsysPs } from "@sma1lboy/kobe-daemon/daemon/process-tree"
import { describe, expect, test } from "vitest"

/**
 * The MSYS half of the Windows tree kill. `taskkill /T` walks Windows parent
 * pids, and under Git Bash an `exec` leaves the new program hanging off a
 * forked process that already exited — so a deleted task's engine survived
 * its tab's teardown. MSYS's own table keeps the real parentage; these pin
 * the read of it. Pure over `ps -l` text, so they run on every platform.
 */

// Shaped on a real orphan: pty root bash (WINPID 59448) → forked subshell
// (exited on Windows, still MSYS pid 44600) → the engine the `claude` shim
// exec'd (WINPID 48024), plus an unrelated shell in another console.
const PS = [
  "      PID    PPID    PGID     WINPID   TTY         UID    STIME COMMAND",
  "    44524       1   44524      59448  cons10    197612 22:25:54 /usr/bin/bash",
  "    44600   44524   44524      61476  cons10    197612 22:26:44 /usr/bin/bash",
  "I   44794   44600   44794      48024  cons10    197612 22:26:44 /c/Users/me/AppData/Roaming/npm/claude",
  "    44900   44794   44794      50000  cons10    197612 22:27:00 /usr/bin/git",
  "    18710       1   18710      37576  cons12    197612 21:12:43 /usr/bin/bash",
  "    18800   18710   18800      37600  cons12    197612 21:12:44 /usr/bin/vim",
].join("\r\n")

describe("parseMsysPs", () => {
  test("reads pid, ppid and Windows pid, with or without a status flag", () => {
    const rows = parseMsysPs(PS)
    expect(rows).toHaveLength(6)
    expect(rows[2]).toEqual({ pid: 44794, ppid: 44600, winpid: 48024 })
  })

  test("skips the header and anything it cannot read", () => {
    expect(parseMsysPs("      PID    PPID    PGID     WINPID\nnot a row\n")).toEqual([])
  })
})

describe("msysDescendantWinpids", () => {
  test("follows MSYS parentage from the shell down to the exec'd engine and its children", () => {
    expect(msysDescendantWinpids(parseMsysPs(PS), 59448).sort()).toEqual([48024, 50000, 61476])
  })

  test("never reaches a process outside the shell's subtree", () => {
    expect(msysDescendantWinpids(parseMsysPs(PS), 59448)).not.toContain(37600)
  })

  test("a root MSYS does not know (a native shell) adds nothing — taskkill /T is complete there", () => {
    expect(msysDescendantWinpids(parseMsysPs(PS), 12345)).toEqual([])
  })

  test("a self-parented row cannot loop the walk", () => {
    const rows = [
      { pid: 1, ppid: 1, winpid: 10 },
      { pid: 2, ppid: 1, winpid: 20 },
    ]
    expect(msysDescendantWinpids(rows, 10)).toEqual([20])
  })
})

describe("msysPsFor", () => {
  test("only a bash shell has an MSYS table to read", () => {
    expect(msysPsFor(undefined)).toBeNull()
    expect(msysPsFor("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")).toBeNull()
  })

  test("a bash with no ps.exe beside it (or one level up in usr/bin) has none either", () => {
    expect(msysPsFor("/definitely/not/here/bash")).toBeNull()
  })
})
