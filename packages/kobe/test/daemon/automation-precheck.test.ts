import { execSync, spawn } from "node:child_process"
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import {
  formatPrecheckSkip,
  precheckPassed,
  runAutomationPrecheck,
  tail,
  withWatchdog,
} from "../../../kobe-daemon/src/daemon/automation-precheck.ts"

const CWD = process.cwd()

describe("tail", () => {
  it("decodes a multi-byte char split across two chunks without mojibake", () => {
    // Node emits a pipe's `data` events split at arbitrary byte offsets, so a
    // multi-byte UTF-8 sequence can straddle two Buffers. Slicing the 4-byte
    // rocket in half is exactly that seam.
    const bytes = Buffer.from("🚀 café 中文", "utf8")
    const first = bytes.subarray(0, 2)
    const second = bytes.subarray(2)
    expect(tail([first, second])).toBe("🚀 café 中文")
    expect(tail([first, second])).not.toContain("�")
  })

  it("keeps a pushed error string in order alongside buffers", () => {
    expect(tail([Buffer.from("out"), "spawn failed"])).toBe("outspawn failed")
  })

  it("caps to the last 4000 code points without halving a surrogate pair", () => {
    // 4001 rockets is past the 4000-char cap; slicing by UTF-16 unit would cut
    // the boundary rocket in half and strand a lone surrogate.
    const capped = tail([Buffer.from("🚀".repeat(4001), "utf8")])
    expect(Array.from(capped)).toHaveLength(4000)
    expect(capped).not.toContain("�")
    expect([...capped].every((point) => point === "🚀")).toBe(true)
  })

  it("returns short output untouched", () => {
    expect(tail([Buffer.from("hello")])).toBe("hello")
    expect(tail([])).toBe("")
  })
})

describe("runAutomationPrecheck", () => {
  it("reports exit 0 as a pass", async () => {
    const result = await runAutomationPrecheck({ command: "exit 0", timeoutSeconds: 10 }, CWD)
    expect(result.exitCode).toBe(0)
    expect(precheckPassed(result)).toBe(true)
  })

  it("reports a non-zero exit as a skip", async () => {
    const result = await runAutomationPrecheck({ command: "exit 7", timeoutSeconds: 10 }, CWD)
    expect(result.exitCode).toBe(7)
    expect(precheckPassed(result)).toBe(false)
    expect(formatPrecheckSkip(result)).toMatch(/exited 7/)
  })

  it("captures stdout and stderr", async () => {
    const result = await runAutomationPrecheck({ command: "echo out; echo err 1>&2; exit 1", timeoutSeconds: 10 }, CWD)
    expect(result.stdout).toContain("out")
    expect(result.stderr).toContain("err")
  })

  it("fails closed on a timeout rather than letting the run proceed", async () => {
    // A hung precheck must not degrade into "run every time" — that is the
    // exact cost the feature exists to avoid.
    const result = await runAutomationPrecheck({ command: "sleep 5", timeoutSeconds: 1 }, CWD)
    expect(result.timedOut).toBe(true)
    expect(precheckPassed(result)).toBe(false)
    expect(formatPrecheckSkip(result)).toMatch(/timed out/)
  })

  it("names a missing working directory instead of blaming the shell", async () => {
    // Node reports a bad cwd as `spawn <shell> ENOENT`, which sends the user
    // hunting for a broken shell. A moved/deleted repo is the likelier story
    // for a schedule that has been running for weeks.
    const result = await runAutomationPrecheck({ command: "exit 0", timeoutSeconds: 10 }, "/definitely/not/a/real/path")
    expect(result.exitCode).toBeNull()
    expect(result.stderr).toMatch(/working directory does not exist/)
    expect(result.stderr).not.toMatch(/ENOENT/)
    expect(precheckPassed(result)).toBe(false)
  })

  it("runs the command through a shell so pipes and && work", async () => {
    const result = await runAutomationPrecheck(
      { command: "echo hello | grep -q hello && exit 0", timeoutSeconds: 10 },
      CWD,
    )
    expect(result.exitCode).toBe(0)
  })

  it("spawns the shell with -ilc, the same interactive login form engine tabs use", async () => {
    // A spy shell records the exact argv it was invoked with, so this pins the
    // flag contract rather than just "a shell ran".
    const dir = mkdtempSync(join(tmpdir(), "kobe-precheck-spy-"))
    const spy = join(dir, "spy.sh")
    const argsFile = join(dir, "args")
    writeFileSync(spy, `#!/bin/sh\n: > "${argsFile}"\nfor a in "$@"; do echo "$a" >> "${argsFile}"; done\nexit 0\n`)
    chmodSync(spy, 0o755)
    const result = await runAutomationPrecheck({ command: "true", timeoutSeconds: 10 }, CWD, spy)
    expect(result.exitCode).toBe(0)
    // The script argument is itself multi-line, so read the file whole rather
    // than splitting it back into arguments.
    const argv = readFileSync(argsFile, "utf8")
    expect(argv.startsWith("-ilc\n")).toBe(true)
    // The user's command is the last line, below the watchdog preamble that
    // bounds it when the daemon is not around to do so.
    expect(argv.trimEnd().endsWith("\ntrue")).toBe(true)
  })

  it("truncates runaway output instead of buffering it all", async () => {
    const result = await runAutomationPrecheck(
      // ~200 KB, well past the 4 KB cap.
      { command: "for i in $(seq 1 5000); do echo 0123456789012345678901234567890123456789; done", timeoutSeconds: 20 },
      CWD,
    )
    expect(result.stdout.length).toBeLessThanOrEqual(4000)
  })
})

describe("orphan containment", () => {
  // A precheck that outlives the daemon is not a tidiness problem. The shape
  // that shipped — `while [ ! -f release ]; do sleep 0.01; done` in a test
  // fixture — spins at ~100 forks a second, and nothing is left to ever
  // create `release`. Thirty-three of them held a Mac at load 170 with 86% of
  // the CPU in the kernel, surviving every daemon restart. Both tests below
  // assert on the PROCESSES, because the old timeout test asserted only that
  // the result said `timedOut` and passed the whole time the leak existed.

  // `pgrep -fx` matches the whole argv, and the markers below are durations
  // nothing else would pick, so this cannot collide with unrelated sleeps on
  // a dev machine.
  const sleepersFor = (marker: string): number =>
    Number(execSync(`pgrep -fx 'sleep ${marker}' | wc -l`).toString().trim())

  it.skipIf(process.platform === "win32")(
    "a timeout kills the command's children, not just the shell",
    async () => {
      const marker = "24771"
      // Three seconds, not one: the interactive shell sources the user's rc
      // files before it reaches the command, so a tighter timeout can fire
      // before the children exist and pass vacuously — which is how the leak
      // stayed invisible.
      const result = await runAutomationPrecheck(
        { command: `sleep ${marker} & sleep ${marker} | cat`, timeoutSeconds: 3 },
        CWD,
      )
      expect(result.timedOut).toBe(true)
      await new Promise((r) => setTimeout(r, 500))
      expect(sleepersFor(marker)).toBe(0)
      execSync(`pkill -fx 'sleep ${marker}' || true`)
    },
    20_000,
  )

  it.skipIf(process.platform === "win32")(
    "the wrapped command bounds itself with no one watching",
    async () => {
      // The real leak: a SIGKILLed daemon takes its timer with it, so anything
      // depending on this process still running is already gone. So run the
      // wrapped command the way an abandoned precheck ends up — detached, with
      // nothing that will ever signal it — and require it to end on its own.
      const marker = "24772"
      const child = spawn("/bin/sh", ["-c", withWatchdog(`sleep ${marker}`, 3)], {
        detached: true,
        stdio: "ignore",
      })
      child.unref()
      try {
        await vi.waitFor(() => expect(sleepersFor(marker)).toBe(1), { timeout: 10_000, interval: 100 })
        // Before the fix this sleep outlived every daemon restart; the only
        // deadline it has now is the one the shell carries itself.
        await vi.waitFor(() => expect(sleepersFor(marker)).toBe(0), { timeout: 15_000, interval: 250 })
      } finally {
        execSync(`pkill -fx 'sleep ${marker}' || true`)
      }
    },
    30_000,
  )
})
