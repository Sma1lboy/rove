import { describe, expect, it } from "vitest"
import { classifyHookChannel, hookChannelDoctorLines } from "../../src/cli/doctor-hook-channel.ts"

const socketPath = "/home/u/.rove/daemon.sock"

describe("classifyHookChannel", () => {
  it("reports down when live tabs exist but none is hook-sourced", () => {
    // The field shape: every badge painted by the ~10s observer
    // poll because each hook silently dropped its event.
    const verdict = classifyHookChannel({
      socketPath,
      tabs: {
        t1: { "tab-1": { source: "observed" }, "tab-2": { source: "observed" } },
        t2: { "tab-1": { source: "observed" } },
      },
    })
    expect(verdict).toEqual({ kind: "down", totalTabs: 3 })
  })

  it("reports live when at least one tab is hook-sourced", () => {
    const verdict = classifyHookChannel({
      socketPath,
      tabs: { t1: { "tab-1": { source: "hook" }, "tab-2": { source: "observed" } } },
    })
    expect(verdict).toEqual({ kind: "live", hookTabs: 1, totalTabs: 2 })
  })

  it("stays silent with no tabs — absence of tabs proves nothing", () => {
    expect(classifyHookChannel({ socketPath, tabs: {} })).toEqual({ kind: "no-tabs" })
  })
})

describe("hookChannelDoctorLines", () => {
  it("keeps the daemon socket and the engine-env hint in the failure block", () => {
    // Doctor cannot inspect the ENGINE's env (that is where the stale path
    // lives), so it prints its own resolved socket plus how to read theirs.
    const lines = hookChannelDoctorLines({ kind: "down", totalTabs: 3 }, { socketPath }, "rove")
    const text = lines.join("\n")
    expect(lines[0]).toContain("NO hook events")
    expect(text).toContain(socketPath)
    expect(text).toContain("DAEMON_SOCKET_PATH")
    expect(text).toContain("KOBE_HOOK_DEBUG=1")
  })

  it("renders a live channel as a single ✓ line", () => {
    const lines = hookChannelDoctorLines({ kind: "live", hookTabs: 2, totalTabs: 4 }, { socketPath }, "rove")
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain("✓")
    expect(lines[0]).toContain("2/4")
  })

  it("names a refused settings file — the SECOND way the channel dies", () => {
    // A stale socket at least leaves live tabs behind. A `hooks` shape the
    // installer cannot parse means the install never ran, and until now
    // nothing in doctor could say so.
    const configIssues = [{ file: "/home/u/.claude/settings.json", reason: '"hooks.PreToolUse" is not an array' }]
    const text = hookChannelDoctorLines({ kind: "down", totalTabs: 3 }, { socketPath, configIssues }, "rove").join("\n")
    expect(text).toContain("hook install skipped: /home/u/.claude/settings.json")
    expect(text).toContain('"hooks.PreToolUse" is not an array')
  })

  it("reports a refused file even when another engine's hooks are live", () => {
    const configIssues = [{ file: "/home/u/.codex/hooks.json", reason: "top level is not a JSON object" }]
    const lines = hookChannelDoctorLines(
      { kind: "live", hookTabs: 2, totalTabs: 4 },
      { socketPath, configIssues },
      "rove",
    )
    expect(lines.join("\n")).toContain("/home/u/.codex/hooks.json")
  })
})
