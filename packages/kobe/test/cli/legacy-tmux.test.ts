import { afterEach, describe, expect, it, vi } from "vitest"
import { inspectLegacyTmux, isMissingServer, legacyTmuxDoctorLines, stopLegacyTmux } from "../../src/cli/legacy-tmux.ts"

function result(stdout = "", code = 0, stderr = "") {
  return {
    stdout: new Response(stdout).body,
    stderr: new Response(stderr).body,
    exited: Promise.resolve(code),
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/**
 * The classifier `rove doctor`'s legacy-tmux row hangs on. tmux exits 1 both
 * when there is no server and when the inspection genuinely broke, so getting
 * this wrong shows a red ✗ to a machine with nothing wrong with it.
 */
describe("isMissingServer", () => {
  const failure = (stderr: string) => ({ code: 1, stdout: "", stderr, missing: false })

  it.each([
    // tmux 3.5a (Apple Git build and Homebrew) when the socket file is absent
    // — every machine that never ran pre-v0.8 Rove. This is the one that was
    // missing, and it turned a healthy install into `✗ inspection failed`.
    "error connecting to /private/tmp/tmux-501/kobe (No such file or directory)",
    // Same wording when the socket is there but its server died.
    "error connecting to /private/tmp/tmux-501/kobe (Connection refused)",
    "no server running on /tmp/tmux-501/kobe",
    "failed to connect to server",
    "no sessions",
  ])("reads %j as an absent server", (stderr) => {
    expect(isMissingServer(failure(stderr))).toBe(true)
  })

  it.each(["permission denied", "lost server", "can't create socket: Operation not permitted"])(
    "reads %j as a real inspection failure",
    (stderr) => {
      expect(isMissingServer(failure(stderr))).toBe(false)
    },
  )
})

describe("legacy tmux process inspection", () => {
  it("reports the healthy no-sessions line when the socket file does not exist", async () => {
    // End to end from the tmux message to the doctor line: this exact stderr
    // is what a machine that never ran pre-v0.8 Rove produces.
    vi.stubGlobal("Bun", {
      spawn: vi.fn((argv: readonly string[]) =>
        argv.join(" ") === "tmux -V"
          ? result("tmux 3.5a\n")
          : result("", 1, "error connecting to /private/tmp/tmux-501/kobe (No such file or directory)\n"),
      ),
    })

    const report = await inspectLegacyTmux()
    expect(report.error).toBeNull()
    expect(report.sessions).toEqual([])
    expect(legacyTmuxDoctorLines(report)).toEqual(["legacy tmux: tmux 3.5a — no sessions on `kobe`"])
  })

  it("surfaces list-sessions failures instead of reporting zero sessions", async () => {
    vi.stubGlobal("Bun", {
      spawn: vi.fn((argv: readonly string[]) =>
        argv.join(" ") === "tmux -V" ? result("tmux 3.6b\n") : result("", 1, "permission denied"),
      ),
    })

    const report = await inspectLegacyTmux()
    expect(report.sessions).toEqual([])
    expect(report.error).toContain("tmux list-sessions failed: permission denied")
    expect(legacyTmuxDoctorLines(report)[0]).toContain("inspection failed")
  })
})

describe("stopLegacyTmux", () => {
  it("SIGTERMs pane process groups before killing the legacy server", async () => {
    const events: string[] = []
    const spawn = vi.fn((argv: readonly string[]) => {
      events.push(argv.join(" "))
      const command = argv.join(" ")
      if (command === "tmux -V") return result("tmux 3.6b\n")
      if (command.includes("list-sessions")) return result("kobe-a\nkobe-b\n")
      if (command.includes("list-panes")) return result("501\n502\n")
      if (command === "ps -axo pid,pgid,rss,comm") {
        return result("PID PGID RSS COMM\n501 501 1024 bun\n502 502 1024 bun\n")
      }
      if (command.startsWith("ps -o pgid=")) return result("502\n")
      if (command.endsWith("kill-server")) return result()
      throw new Error(`unexpected command: ${command}`)
    })
    vi.stubGlobal("Bun", { spawn })
    const kill = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
      if (signal === 0) throw Object.assign(new Error("gone"), { code: "ESRCH" })
      events.push(`SIGTERM ${pid}`)
      return true
    })

    await expect(stopLegacyTmux("test-socket")).resolves.toEqual({
      status: "stopped",
      sessions: 2,
      signalledGroups: 1,
    })
    expect(kill).toHaveBeenCalledWith(-501, "SIGTERM")
    expect(kill).not.toHaveBeenCalledWith(-502, "SIGTERM")
    expect(events.indexOf("SIGTERM -501")).toBeLessThan(events.indexOf("tmux -L test-socket kill-server"))
  })

  it("refuses HUP-only cleanup when pane enumeration fails", async () => {
    const spawn = vi.fn((argv: readonly string[]) => {
      const command = argv.join(" ")
      if (command === "tmux -V") return result("tmux 3.6b\n")
      if (command.includes("list-sessions")) return result("kobe-a\n")
      if (command.includes("list-panes")) return result("", 1, "permission denied")
      throw new Error(`unexpected command: ${command}`)
    })
    vi.stubGlobal("Bun", { spawn })
    const kill = vi.spyOn(process, "kill")

    await expect(stopLegacyTmux("test-socket")).resolves.toMatchObject({
      status: "failed",
      error: "tmux list-panes failed: permission denied",
    })
    expect(kill).not.toHaveBeenCalled()
    expect(spawn.mock.calls.some(([argv]) => (argv as readonly string[]).includes("kill-server"))).toBe(false)
  })

  it("fails instead of swallowing a process-group permission error", async () => {
    const spawn = vi.fn((argv: readonly string[]) => {
      const command = argv.join(" ")
      if (command === "tmux -V") return result("tmux 3.6b\n")
      if (command.includes("list-sessions")) return result("kobe-a\n")
      if (command.includes("list-panes")) return result("501\n")
      if (command === "ps -axo pid,pgid,rss,comm") return result("PID PGID RSS COMM\n501 501 1024 bun\n")
      if (command.startsWith("ps -o pgid=")) return result("999\n")
      throw new Error(`unexpected command: ${command}`)
    })
    vi.stubGlobal("Bun", { spawn })
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("not permitted"), { code: "EPERM" })
    })

    await expect(stopLegacyTmux("test-socket")).resolves.toMatchObject({
      status: "failed",
      error: "failed to SIGTERM pane group 501: not permitted",
    })
    expect(spawn.mock.calls.some(([argv]) => (argv as readonly string[]).includes("kill-server"))).toBe(false)
  })

  it("reports kill-server failure while the legacy server remains live", async () => {
    let listCalls = 0
    const spawn = vi.fn((argv: readonly string[]) => {
      const command = argv.join(" ")
      if (command === "tmux -V") return result("tmux 3.6b\n")
      if (command.includes("list-sessions")) {
        listCalls++
        return result("kobe-a\n")
      }
      if (command.includes("list-panes")) return result("501\n")
      if (command === "ps -axo pid,pgid,rss,comm") return result("PID PGID RSS COMM\n501 501 1024 bun\n")
      if (command.startsWith("ps -o pgid=")) return result("999\n")
      if (command.endsWith("kill-server")) return result("", 1, "permission denied")
      throw new Error(`unexpected command: ${command}`)
    })
    vi.stubGlobal("Bun", { spawn })
    vi.spyOn(process, "kill").mockReturnValue(true)

    await expect(stopLegacyTmux("test-socket")).resolves.toMatchObject({
      status: "failed",
      error: "permission denied",
    })
    expect(listCalls).toBe(2)
  })
})
