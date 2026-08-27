import { describe, expect, it } from "vitest"
import { classifyHookChannel, hookChannelDoctorLines } from "../../src/cli/doctor-hook-channel.ts"

const socketPath = "/home/u/.rove/daemon.sock"

describe("classifyHookChannel", () => {
  it("reports down when live tabs exist but none is hook-sourced", () => {
    // The 2026-08-26 field shape: every badge painted by the ~10s observer
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
  it("names the stale env override that shadowed the live socket", () => {
    const override = "/home/u/.kobe/daemon.sock"
    const lines = hookChannelDoctorLines(
      { kind: "down", totalTabs: 3 },
      { socketPath, socketOverride: override },
      "rove",
    )
    expect(lines.join("\n")).toContain(override)
    expect(lines[0]).toContain("NO hook events")
  })

  it("omits the override hint when it matches the resolved socket", () => {
    const lines = hookChannelDoctorLines(
      { kind: "down", totalTabs: 1 },
      { socketPath, socketOverride: socketPath },
      "rove",
    )
    expect(lines.join("\n")).not.toContain("points elsewhere")
  })

  it("renders a live channel as a single ✓ line", () => {
    const lines = hookChannelDoctorLines({ kind: "live", hookTabs: 2, totalTabs: 4 }, { socketPath }, "rove")
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain("✓")
    expect(lines[0]).toContain("2/4")
  })
})
