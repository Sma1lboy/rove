/**
 * The per-session Job Object (Windows). Pure parts everywhere; the real
 * launcher — compiled by csc, an orphan killed through it — only on Windows,
 * where the leak it fixes exists.
 */

import { execFile, spawn } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import {
  PTY_JOB_ENV,
  PTY_JOB_LAUNCHER_CS,
  PTY_JOB_OWNER_ENV,
  ensurePtyJobLauncher,
  launcherFileName,
  newPtyJobName,
  ptyJobLaunch,
  withoutPtyJob,
} from "../../../kobe-daemon/src/daemon/win-pty-job.ts"

describe("ptyJobLaunch", () => {
  const inTab = { [PTY_JOB_ENV]: "Local\\rove-pty-1", [PTY_JOB_OWNER_ENV]: "C:\\Users\\a\\.rove\\daemon.sock" }

  it("is null outside a session: the launch stays what it always was", () => {
    expect(ptyJobLaunch({}, "C:\\Users\\a\\.rove\\daemon.sock")).toBeNull()
    expect(ptyJobLaunch({ [PTY_JOB_ENV]: "Local\\x" }, "s")).toBeNull()
  })

  it("lets the same instance escape the tab, however its socket is spelled", () => {
    expect(ptyJobLaunch(inTab, "C:\\Users\\a\\.rove\\daemon.sock")).toEqual({
      job: "Local\\rove-pty-1",
      mode: "escape",
    })
    expect(ptyJobLaunch(inTab, "c:/users/A/.rove/daemon.sock")?.mode).toBe("escape")
  })

  it("keeps another instance (a nested sandbox) in the tab's job", () => {
    expect(ptyJobLaunch(inTab, "C:\\repo\\.dev-sandbox\\home\\.rove\\daemon.sock")).toEqual({
      job: "Local\\rove-pty-1",
      mode: "join",
    })
  })
})

describe("withoutPtyJob", () => {
  it("drops only the job claim", () => {
    const env = { PATH: "p", [PTY_JOB_ENV]: "j", [PTY_JOB_OWNER_ENV]: "o" }
    expect(withoutPtyJob(env)).toEqual({ PATH: "p" })
    expect(env[PTY_JOB_ENV]).toBe("j")
  })
})

describe("the launcher source", () => {
  it("kills the job when its handle closes and denies breakaway (node's detached spawn escapes otherwise)", () => {
    expect(PTY_JOB_LAUNCHER_CS).toContain("LimitFlags = 0x2000;")
    expect(PTY_JOB_LAUNCHER_CS).not.toMatch(/0x800\b/)
  })

  it("is content-addressed, so an edited launcher never reuses a stale build", () => {
    expect(launcherFileName("a")).not.toBe(launcherFileName("b"))
    expect(launcherFileName()).toMatch(/^rove-pty-job-[0-9a-f]{12}\.exe$/)
  })

  it("names every job freshly", () => {
    expect(newPtyJobName()).not.toBe(newPtyJobName())
  })
})

const alive = (pid: number): boolean => {
  // process.kill(0) is THIS process's group: a missing pid must not read as live.
  if (!(pid > 0)) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe.skipIf(process.platform !== "win32")("the real launcher (Windows)", () => {
  const dir = mkdtempSync(join(tmpdir(), "rove-pty-job-"))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it("compiles, passes its self-test, and kills an orphan whose parent already exited", async () => {
    const launcher = await ensurePtyJobLauncher(join(dir, "bin"))
    expect(launcher.reason).toBeUndefined()
    const exe = launcher.path as string

    // shell (stays) → middle → detached orphan, then middle exits: no
    // ParentProcessId walk (taskkill /T) reaches the orphan any more.
    const pidFile = join(dir, "orphan.pid")
    const orphanJs = join(dir, "orphan.js")
    const middleJs = join(dir, "middle.js")
    const shellJs = join(dir, "shell.js")
    writeFileSync(
      orphanJs,
      `require("fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1e9)`,
    )
    writeFileSync(
      middleJs,
      `require("child_process").spawn(process.execPath, [${JSON.stringify(orphanJs)}], { detached: true, stdio: "ignore" }).unref(); setTimeout(() => process.exit(0), 200)`,
    )
    writeFileSync(
      shellJs,
      `require("child_process").spawn(process.execPath, [${JSON.stringify(middleJs)}], { stdio: "ignore" }); setInterval(() => {}, 1e9)`,
    )
    const session = spawn(exe, [process.execPath, shellJs], {
      stdio: "ignore",
      windowsHide: true,
      env: { ...process.env, [PTY_JOB_ENV]: newPtyJobName() },
    })
    let orphan = 0
    for (let i = 0; i < 100 && !orphan; i++) {
      await new Promise((r) => setTimeout(r, 100))
      try {
        orphan = Number(readFileSync(pidFile, "utf8"))
      } catch {
        /* not yet */
      }
    }
    expect(orphan).toBeGreaterThan(0)
    expect(alive(orphan)).toBe(true)

    // End the session the way the host does: the launcher dies, so does the job.
    await new Promise((r) => execFile("taskkill", ["/F", "/PID", String(session.pid)], r))
    for (let i = 0; i < 50 && alive(orphan); i++) await new Promise((r) => setTimeout(r, 100))
    const survived = alive(orphan)
    if (survived) process.kill(orphan)
    expect(survived).toBe(false)
  }, 60_000)

  it("still runs the command, exit code intact, when no job is named", async () => {
    const launcher = await ensurePtyJobLauncher(join(dir, "bin"))
    const env = { ...process.env }
    delete env[PTY_JOB_ENV]
    const code = await new Promise((r) =>
      spawn(launcher.path as string, [process.execPath, "-e", "process.exit(5)"], { stdio: "ignore", env }).on(
        "exit",
        r,
      ),
    )
    expect(code).toBe(5)
  }, 60_000)

  it("rebuilds a cached launcher that will not run, instead of crashing the host or giving up", async () => {
    const bin = join(dir, "broken-bin")
    mkdirSync(bin, { recursive: true })
    // A truncated or quarantined build: Windows refuses to start it, and
    // execFile throws synchronously.
    writeFileSync(join(bin, launcherFileName()), "MZ not a program")
    const launcher = await ensurePtyJobLauncher(bin)
    expect(launcher.reason).toBeUndefined()
    expect(launcher.path).toBe(join(bin, launcherFileName()))
  }, 60_000)
})
