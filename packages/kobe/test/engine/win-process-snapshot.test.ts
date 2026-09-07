/**
 * The Windows process walk, against the two failures that made every task on
 * Windows 11 report `running: false` while its agent sat at the prompt:
 * a `ps` that cannot run at all, and a parent chain the npm shim's `cmd.exe`
 * takes with it when it exits.
 *
 * Fixtures are transcribed from a real affected machine (`Get-CimInstance
 * Win32_Process`, `GetConsoleProcessList`). Nothing here spawns.
 */

import { describe, expect, it } from "vitest"
import { engineProcessIn, foregroundEngineIn, parsePsSnapshot } from "../../src/engine/foreground.ts"
import { PsProbeUnavailableError } from "../../src/engine/process-rows.ts"
import {
  WIN_PROBE_TIMEOUT_MS,
  type WinProcessProbe,
  defaultWinProcessProbe,
  normalizeWindowsArgs,
  parseWinProcessList,
  repairConsoleParentage,
  winProcessSnapshot,
} from "../../src/engine/win-process-snapshot.ts"

/**
 * A real tab, transcribed. Note 39384's parent 37192: that is the npm shim's
 * `cmd.exe`, and it is NOT in the list because it exited seconds after launch.
 * `Get-CimInstance` renders paths with spaces quoted, and Rove's own launch
 * script carries literal newlines (already flattened by the PowerShell side).
 */
const CIM = [
  '9052 35316 "C:\\Program Files\\nodejs\\node.EXE" C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@sma1lboy\\rove\\dist\\cli\\pty-host-node.mjs',
  "39308 9052 \"C:\\Program Files\\Git\\bin\\bash.exe\" -ilc \"export ROVE_TASK_ID='01M1V7' ROVE_TAB_ID='tab-1' claude --resume 151c2514\"",
  "27272 39308 \"C:\\Program Files\\Git\\bin\\..\\usr\\bin\\bash.exe\" -ilc \"export ROVE_TASK_ID='01M1V7' ROVE_TAB_ID='tab-1' claude --resume 151c2514\"",
  '39384 37192 "C:\\Program Files\\Git\\usr\\bin\\sh.exe" /c/Users/me/AppData/Roaming/npm/claude --dangerously-skip-permissions --resume 151c2514',
  "19252 39384 C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe --dangerously-skip-permissions --resume 151c2514",
  "4 0 System",
].join("\n")

/** Every pid `GetConsoleProcessList` reports for tab 39308's ConPTY console. */
const COHORT_39308 = [19252, 39384, 27272, 39308]

describe("normalizeWindowsArgs", () => {
  it("unwraps a quoted argv[0] to its basename, so the walk sees the executable", () => {
    // Split on whitespace, `"C:\Program Files\...\sh.exe" …` reads as
    // `"C:\Program` — the identity parser then answers `Program`, not `sh`.
    expect(normalizeWindowsArgs('"C:\\Program Files\\Git\\usr\\bin\\sh.exe" /c/npm/claude --resume x')).toBe(
      "sh.exe /c/npm/claude --resume x",
    )
  })

  it("basenames an unquoted argv[0] and leaves the arguments alone", () => {
    expect(normalizeWindowsArgs('C:\\Users\\me\\bin\\claude.exe --resume "Minecraft 服务器调研"')).toBe(
      'claude.exe --resume "Minecraft 服务器调研"',
    )
  })

  it("handles a bare executable, a trailing quote, and empty input", () => {
    expect(normalizeWindowsArgs("System")).toBe("System")
    expect(normalizeWindowsArgs('"C:\\a b\\claude.exe')).toBe("claude.exe")
    expect(normalizeWindowsArgs("   ")).toBe("")
  })
})

describe("parseWinProcessList", () => {
  const rows = parseWinProcessList(CIM)

  it("reads pid, ppid and a walkable command line off each CIM line", () => {
    expect(rows).toHaveLength(6)
    expect(rows.find((r) => r.pid === 39384)).toEqual({
      pid: 39384,
      ppid: 37192,
      args: "sh.exe /c/Users/me/AppData/Roaming/npm/claude --dangerously-skip-permissions --resume 151c2514",
    })
  })

  it("keeps rows whose only text is a process Name (no readable CommandLine)", () => {
    // A row dropped here can break a chain that runs THROUGH it.
    expect(rows.find((r) => r.pid === 4)).toEqual({ pid: 4, ppid: 0, args: "System" })
  })

  it("skips lines that are not a process row", () => {
    expect(parseWinProcessList("\n\nnot a row\n123 456 ok\n")).toEqual([{ pid: 123, ppid: 456, args: "ok" }])
  })
})

describe("repairConsoleParentage (the npm shim's cmd.exe took the chain with it)", () => {
  const raw = parseWinProcessList(CIM)

  it("cannot reach the engine before the repair — the bug, reproduced", () => {
    expect(foregroundEngineIn(raw, 39308)).toBeNull()
    expect(engineProcessIn(raw, 39308)).toBe(false)
  })

  it("reattaches the orphan to the tab's shell, and the walk finds claude", () => {
    const fixed = repairConsoleParentage(raw, new Map([[39308, COHORT_39308]]))
    expect(fixed.find((r) => r.pid === 39384)?.ppid).toBe(39308)
    expect(foregroundEngineIn(fixed, 39308)?.vendor).toBe("claude")
    expect(engineProcessIn(fixed, 39308)).toBe(true)
  })

  it("keeps a member whose parent is also on the console, so depth survives", () => {
    const fixed = repairConsoleParentage(raw, new Map([[39308, COHORT_39308]]))
    // claude.exe stays under sh.exe (its real parent, also on this console)
    // rather than being flattened onto the shell.
    expect(fixed.find((r) => r.pid === 19252)?.ppid).toBe(39384)
    expect(fixed.find((r) => r.pid === 27272)?.ppid).toBe(39308)
  })

  it("never reparents the shell itself, whose parent is the PTY host", () => {
    const fixed = repairConsoleParentage(raw, new Map([[39308, COHORT_39308]]))
    expect(fixed.find((r) => r.pid === 39308)?.ppid).toBe(9052)
  })

  it("leaves an anchor alone when its console could not be read", () => {
    // A dead tab: AttachConsole fails, and a guess would be worse than none.
    expect(repairConsoleParentage(raw, new Map([[39308, null]]))).toEqual(raw)
  })

  it("ignores cohort members and anchors that are not in the snapshot", () => {
    const fixed = repairConsoleParentage(
      raw,
      new Map([
        [999999, [1, 2]],
        [39308, [...COHORT_39308, 424242]],
      ]),
    )
    expect(fixed.find((r) => r.pid === 39384)?.ppid).toBe(39308)
  })
})

function probe(overrides: Partial<WinProcessProbe> = {}): WinProcessProbe {
  return {
    processList: async () => CIM,
    consoleCohorts: async (anchors) => new Map(anchors.map((a) => [a, a === 39308 ? COHORT_39308 : null])),
    ...overrides,
  }
}

describe("winProcessSnapshot", () => {
  it("renders a repaired snapshot in the text shape every walk already parses", async () => {
    const rows = parsePsSnapshot(await winProcessSnapshot([39308], probe()))
    expect(foregroundEngineIn(rows, 39308)?.vendor).toBe("claude")
    expect(engineProcessIn(rows, 39308)).toBe(true)
  })

  it("skips the console probe when there is nothing to anchor on", async () => {
    let asked = 0
    const rows = parsePsSnapshot(
      await winProcessSnapshot(
        [],
        probe({
          consoleCohorts: async () => {
            asked++
            return new Map()
          },
        }),
      ),
    )
    expect(asked).toBe(0)
    expect(rows.length).toBe(6)
  })

  it("throws rather than answering 'no engine' when the process table is empty", async () => {
    // The original Windows failure: `ps -A` exited 1 with empty stdout and the
    // zero rows were published as a confident absence.
    await expect(winProcessSnapshot([39308], probe({ processList: async () => "" }))).rejects.toBeInstanceOf(
      PsProbeUnavailableError,
    )
  })

  it("throws rather than answering with an unrepaired tree when the console probe fails", async () => {
    // Unrepaired rows would say "no engine" for a tab whose engine is running,
    // which is the bug — so this has to travel as "unknown".
    await expect(
      winProcessSnapshot([39308], probe({ consoleCohorts: async () => Promise.reject(new Error("no addon")) })),
    ).rejects.toThrow()
  })
})

describe("the Windows probe budget", () => {
  it("is wider than the POSIX one, and still fits twice in the engine readiness window", () => {
    // PowerShell + CIM costs ~0.8s where `ps` costs ~20ms, so the 5s POSIX cap
    // fired on probes that were merely slow on a loaded machine — spending the
    // tri-state on noise. It still has to leave room for a second attempt
    // inside `awaitEngineProcess`'s 20s budget.
    expect(WIN_PROBE_TIMEOUT_MS).toBeGreaterThan(5_000)
    expect(WIN_PROBE_TIMEOUT_MS).toBeLessThanOrEqual(10_000)
  })

  it("shares one deadline across both children rather than giving each the full budget", async () => {
    // A spent budget refuses before spawning anything.
    await expect(defaultWinProcessProbe(0).processList()).rejects.toBeInstanceOf(PsProbeUnavailableError)
    await expect(defaultWinProcessProbe(0).consoleCohorts([1])).rejects.toBeInstanceOf(PsProbeUnavailableError)
  })
})
