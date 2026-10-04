import { describe, expect, it, vi } from "vitest"
import {
  type FixRuntime,
  applyFixes,
  daemonRestartFix,
  dedupeFixes,
  humanOnlyFix,
  noEngineAction,
  noEngineFix,
  resetManualFix,
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

  // The engine remedy branches on WHICH half failed. The installed-but-
  // logged-out arm is the one a cold machine actually hits, and it used to
  // print "install an engine CLI" directly under rows carrying those CLIs'
  // absolute paths.
  it("tells an installed-but-logged-out machine to log in, naming the engines", () => {
    const fix = noEngineFix(["claude", "codex"])
    expect(fix.kind).toBe("manual")
    expect(noEngineAction(["claude", "codex"])).toContain("claude, codex")
    expect(noEngineAction(["claude", "codex"])).toContain("login")
    expect(noEngineAction(["claude", "codex"])).not.toContain("install an engine CLI")
  })
})
