import { describe, expect, it, vi } from "vitest"
import {
  type DoctorFix,
  type FixRuntime,
  applyFixes,
  daemonRestartFix,
  dedupeFixes,
  engineTabsManualFix,
  humanOnlyFix,
  resetManualFix,
  skillInstallFix,
} from "../../src/cli/doctor-fix.ts"

function runtime(overrides: Partial<FixRuntime> = {}): FixRuntime & { lines: string[] } {
  const lines: string[] = []
  return {
    confirm: vi.fn(async () => true),
    exec: vi.fn(async () => 0),
    out: (line: string) => lines.push(line),
    interactive: true,
    lines,
    ...overrides,
  }
}

describe("fix construction", () => {
  it("daemon restart is a runnable fix carrying the exact command", () => {
    const fix = daemonRestartFix("rove", "daemonStale")
    expect(fix.kind).toBe("run")
    expect(fix.id).toBe("daemon-restart")
    expect(fix.kind === "run" && fix.command).toEqual(["rove", "daemon", "restart"])
  })

  it("skill install runs the wrapper command doctor already prints", () => {
    const fix = skillInstallFix("kobe skill install", true)
    expect(fix.kind === "run" && fix.command).toEqual(["kobe", "skill", "install"])
  })

  it("reset, engine-tab restarts, and installs/logins are manual (print-only)", () => {
    for (const fix of [
      resetManualFix("rove", "resetDaemonWedged"),
      resetManualFix("rove", "resetPty"),
      resetManualFix("rove", "resetLegacy"),
      engineTabsManualFix(),
      humanOnlyFix("git"),
      humanOnlyFix("noEngine"),
      humanOnlyFix("windowsNode"),
    ]) {
      expect(fix.kind).toBe("manual")
    }
    const reset = resetManualFix("rove", "resetPty")
    expect(reset.kind === "manual" && reset.action).toBe("rove reset")
  })

  it("dedupes repeat proposals of the same remedy", () => {
    const fixes = [
      daemonRestartFix("rove", "daemonStale"),
      daemonRestartFix("rove", "hooksDown"),
      resetManualFix("rove", "resetPty"),
    ]
    const deduped = dedupeFixes(fixes)
    expect(deduped).toHaveLength(2)
    expect(deduped[0].id).toBe("daemon-restart")
  })
})

describe("applyFixes", () => {
  it("executes a runnable fix only after a per-fix confirmation", async () => {
    const rt = runtime()
    await applyFixes([daemonRestartFix("rove", "daemonStale")], rt)
    expect(rt.confirm).toHaveBeenCalledTimes(1)
    expect(rt.exec).toHaveBeenCalledTimes(1)
    expect(rt.exec).toHaveBeenCalledWith(["rove", "daemon", "restart"])
    expect(rt.lines.join("\n")).toContain("will run: rove daemon restart")
    expect(rt.lines.join("\n")).toContain("✓ done")
  })

  it("a declined confirmation skips the fix without executing", async () => {
    const rt = runtime({ confirm: vi.fn(async () => false) })
    await applyFixes([daemonRestartFix("rove", "daemonStale")], rt)
    expect(rt.exec).not.toHaveBeenCalled()
    expect(rt.lines.join("\n")).toContain("skipped")
  })

  it("NEVER executes a manual fix, even when everything is confirmed", async () => {
    const rt = runtime()
    await applyFixes([resetManualFix("rove", "resetDaemonWedged"), humanOnlyFix("git")], rt)
    expect(rt.confirm).not.toHaveBeenCalled()
    expect(rt.exec).not.toHaveBeenCalled()
    expect(rt.lines.join("\n")).toContain("→ rove reset")
  })

  it("without a TTY nothing is executed — the plan is printed instead", async () => {
    const rt = runtime({ interactive: false })
    await applyFixes([daemonRestartFix("rove", "daemonDown")], rt)
    expect(rt.confirm).not.toHaveBeenCalled()
    expect(rt.exec).not.toHaveBeenCalled()
    expect(rt.lines.join("\n")).toContain("will run: rove daemon restart")
    expect(rt.lines.join("\n")).toContain("nothing was executed")
  })

  it("reports a failing fix command's exit code", async () => {
    const rt = runtime({ exec: vi.fn(async () => 1) })
    await applyFixes([daemonRestartFix("rove", "daemonStale")], rt)
    expect(rt.lines.join("\n")).toContain("exited with code 1")
  })

  it("says so when there is nothing to fix", async () => {
    const rt = runtime()
    await applyFixes([] as DoctorFix[], rt)
    expect(rt.exec).not.toHaveBeenCalled()
    expect(rt.lines.join("\n")).toContain("nothing to fix")
  })
})
