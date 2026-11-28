/**
 * `--electron`: the real desktop shell, captured as the OS draws it (frame and traffic lights) with
 * `screencapture -l`. Its windows show without taking focus (`electron-preload.cjs`), so the tour runs behind
 * whatever the owner is doing. macOS only.
 */

import { type ChildProcess, execFileSync, spawn } from "node:child_process"
import { mkdir, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { type Browser, type Page, chromium } from "@playwright/test"
import type { Entry } from "./manifest.ts"
import { trackWire } from "./drive.ts"
import { type WindowDriver, freePort } from "./shoot.ts"

interface Running {
  readonly key: string
  readonly proc: ChildProcess
  readonly browser: Browser
  readonly page: Page
  readonly windowId: string
}

const poll = async <T>(what: string, ms: number, probe: () => Promise<T | null | undefined>): Promise<T> => {
  const end = Date.now() + ms
  for (;;) {
    const value = await probe().catch(() => null)
    if (value) return value
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 150))
  }
}

/** Every process below `root`, from one `ps` snapshot. */
function descendants(root: number): number[] {
  const rows = execFileSync("ps", ["-Ao", "pid=,ppid="], { encoding: "utf8" })
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/).map(Number))
  const out: number[] = []
  for (let frontier = [root]; frontier.length > 0; ) {
    frontier = rows.filter(([, ppid]) => frontier.includes(ppid!)).map(([pid]) => pid!)
    out.push(...frontier)
  }
  return out
}

export async function electronWindow(root: string, repo: string): Promise<WindowDriver> {
  if (process.platform !== "darwin") throw new Error("--electron captures macOS windows (screencapture -l); run it on a Mac")
  const desktop = join(repo, "packages/rove-desktop")
  execFileSync("bun", ["run", "build"], { cwd: desktop, stdio: "ignore" })
  const electron = join(desktop, "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron")
  const helper = join(root, "window-id")
  await mkdir(root, { recursive: true })
  execFileSync("swiftc", ["-O", "-o", helper, join(import.meta.dirname, "window-id.swift")], { stdio: "ignore" })
  let running: Running | null = null
  let launches = 0

  async function stop(): Promise<void> {
    if (!running) return
    const { proc, browser } = running
    running = null
    await browser.close().catch(() => {})
    if (proc.exitCode === null) {
      // The install window's installer outlives the app it ran in; it is ours too.
      const tree = descendants(proc.pid!)
      const gone = new Promise((r) => proc.once("exit", r))
      proc.kill("SIGTERM")
      await gone
      for (const pid of tree) {
        try {
          process.kill(pid, "SIGTERM")
        } catch {
          // Already gone with its parent.
        }
      }
    }
  }

  /** One app per bridge URL (the shell only navigates within its own origin), or per installer command for the install window. */
  async function launch(key: string, env: Record<string, string>): Promise<Running> {
    await stop()
    const port = await freePort()
    const userData = join(root, `user-data-${launches++}`)
    const proc = spawn(electron, ["-r", join(import.meta.dirname, "electron-preload.cjs"), desktop, `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`], {
      cwd: desktop,
      env,
      stdio: "ignore",
    })
    const browser = await poll("the Electron debugger", 20_000, () => chromium.connectOverCDP(`http://127.0.0.1:${port}`))
    const page = await poll("the Electron window", 20_000, async () =>
      browser.contexts().flatMap((c) => c.pages()).find((p) => !p.url().startsWith("devtools")),
    )
    trackWire(page)
    const windowId = await poll("its on-screen window", 20_000, async () => execFileSync(helper, [String(proc.pid)], { encoding: "utf8" }).trim())
    running = { key, proc, browser, page, windowId }
    return running
  }

  const base = (home: string): Record<string, string> => ({
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    HOME: home,
    TMPDIR: process.env.TMPDIR ?? "/tmp",
    USER: process.env.USER ?? "",
    SHELL: "/bin/sh",
  })

  return {
    async open(url: string, entry: Entry): Promise<Page> {
      if (entry.electron === "only") {
        // No `rove` on this PATH or under this HOME: the shell opens its install window.
        const run = await launch(`setup:${entry.installCmd}`, { ...base(join(root, "setup-home")), ROVE_DESKTOP_INSTALL_CMD: entry.installCmd ?? "true" })
        await run.page.waitForLoadState("domcontentloaded")
        return run.page
      }
      // The shell looks for a `rove` before it reads ROVE_DESKTOP_URL; any executable answers, none is run.
      if (running?.key !== url) await launch(url, { ...base(join(root, "app-home")), ROVE_DESKTOP_URL: url, ROVE_DESKTOP_BIN: "/usr/bin/true" })
      await running!.page.goto(url)
      return running!.page
    },
    async capture(): Promise<Buffer> {
      const file = join(root, "capture.png")
      execFileSync("screencapture", ["-x", "-o", "-l", running!.windowId, file])
      const png = await readFile(file)
      await rm(file)
      return png
    },
    close: stop,
  }
}
