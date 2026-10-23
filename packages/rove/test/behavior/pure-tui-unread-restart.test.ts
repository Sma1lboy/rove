/**
 * Regression pin: a session you have already read must not come back UNREAD
 * after you quit rove and start it again.
 *
 * The bug is environment-shaped, which is why this test spends two real TUI
 * processes on it: the daemon's activity registry outlives the TUI, so the
 * second launch is handed the very same `turn_complete`. "Unseen" is the
 * daemon's to say now (its attention inbox, cleared when a client reports
 * viewing the tab with `ui.viewing`), so the read must outlive the TUI that
 * made it. Nothing short of an actual restart against a live daemon proves it.
 *
 * Shape: complete a turn on task A, let launch #1 sit in A (reading it), then
 * make task B the active one so launch #2 opens somewhere else and A's row is
 * one you are NOT looking at — exactly where the lamp shows. A task is one
 * conversation, so the lamp is on the task row itself.
 */

import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Terminal } from "@xterm/headless"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { SIDEBAR_WIDTH } from "../../src/tui/panes/sidebar/view-core.ts"
import {
  type BehaviorEnv,
  DIST_ROVE_CLI,
  closeTui,
  loadNodePty,
  makeBehaviorEnv,
  makeScratchRepo,
  runRove,
} from "./harness.ts"

const nodePty = await loadNodePty()

const COLS = 140
const ROWS = 40
/** ● an unread completion, ○ one already looked at (· = no signal at all). */
const UNREAD = "●"
const SEEN = "○"

/** Is that pid still a live process? (signal 0 = existence probe.) */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function poll(predicate: () => boolean | Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

describe.skipIf(!nodePty)("Pure TUI unread lamp across a restart (behavior)", () => {
  let env: BehaviorEnv
  let repo: string
  let taskId: string
  let otherId: string
  /** What A's rail row reads (its task title); B's differs. */
  let label: string
  /** The pid of the most recent `withTui` launch, for the exited-yet check. */
  let lastTuiPid = 0

  /**
   * Boot the real TUI and hand back its screen as plain text lines — the
   * frame goes through a headless xterm, so a row reads as the cells the user
   * sees rather than as a stream of escapes with a glyph buried in it.
   */
  async function withTui<T>(run: (screen: () => string[]) => Promise<T>): Promise<T> {
    if (!nodePty) throw new Error("unreachable: suite is skipped without node-pty")
    const term = new Terminal({ cols: COLS, rows: ROWS, allowProposedApi: true })
    // This child would inherit vitest's markers, and the host-session poll is
    // off under a test RUNNER — it is a real TUI in its own process.
    const { VITEST, NODE_ENV, BUN_TEST, ...tuiEnv } = env.env as Record<string, string>
    const child = nodePty.spawn("bun", [DIST_ROVE_CLI], { cols: COLS, rows: ROWS, cwd: repo, env: tuiEnv })
    lastTuiPid = child.pid
    const data = child.onData((chunk: string) => term.write(chunk))
    try {
      return await run(() => {
        const buffer = term.buffer.active
        const lines: string[] = []
        for (let y = 0; y < ROWS; y++) lines.push(buffer.getLine(y)?.translateToString(true) ?? "")
        return lines
      })
    } finally {
      data.dispose()
      await closeTui(child)
    }
  }

  /** A's task row in the rail: its lamp is the glyph at the head of the line. */
  function taskRow(lines: readonly string[]): string {
    return lines.map((line) => line.slice(0, SIDEBAR_WIDTH)).find((line) => line.includes(label)) ?? ""
  }

  beforeAll(async () => {
    env = await makeBehaviorEnv()
    repo = await makeScratchRepo(env)
    // Rove reads and writes its canonical state; the legacy path is migration
    // input only, not a live mirror.
    const stateDir = join(env.home, ".config", "rove")
    await mkdir(stateDir, { recursive: true })
    // Both flags: `onboarded` alone means "the questions were asked" (it is
    // set before the wizard renders), not "the wizard finished". Without the
    // primer, this launch gets the wizard instead of the TUI.
    await writeFile(join(stateDir, "state.json"), JSON.stringify({ onboarded: true, onboardedPrimer: true }))

    // `--prompt` takes the headless launch path: worktree + hosted engine
    // session under `<taskId>::tab-1`, plus the snapshot the TUI renders from.
    // Distinct prompts: the rail row is LABELLED by the task's title.
    const add = runRove(["api", "add", "--repo", repo, "--branch", "rove/pin", "--prompt", "hello pin"], env)
    expect(add.code, add.stderr).toBe(0)
    const added = JSON.parse(add.stdout) as { task: { id: string; title: string } }
    taskId = added.task.id
    label = added.task.title.slice(0, 10)
    const other = runRove(["api", "add", "--repo", repo, "--branch", "rove/other", "--prompt", "elsewhere"], env)
    expect(other.code, other.stderr).toBe(0)
    otherId = (JSON.parse(other.stdout) as { task: { id: string } }).task.id

    await poll(() => {
      const sessions = JSON.parse(runRove(["api", "pty-list"], env).stdout) as {
        sessions?: { key: string; alive?: boolean }[]
      }
      return sessions.sessions?.some((s) => s.key === `${taskId}::tab-1` && s.alive) === true
    }, 30_000)

    // Launch #1 boots into A.
    const active = runRove(["api", "set-active", "--task-id", taskId], env)
    expect(active.code, active.stderr).toBe(0)

    // The turn the user is about to read. An engine tab passes canonical IDs
    // plus the compatibility aliases, so the daemon records this completion
    // against tab-1.
    const hook = runRove(["hook", "turn-complete", "--engine", "claude-code-local"], {
      ...env,
      env: {
        ...env.env,
        ROVE_TASK_ID: taskId,
        ROVE_TAB_ID: "tab-1",
      },
    })
    expect(hook.code, hook.stderr).toBe(0)
  }, 120_000)

  afterAll(async () => {
    await env.dispose()
  })

  it("keeps a completion read after rove is restarted", async () => {
    // Launch #1 — boot lands in the restored session, so A is the task the
    // user is looking at and its completion is read.
    await withTui(async (screen) => {
      await poll(() => screen().some((line) => line.includes("scratch-repo")), 30_000)
      expect(
        screen().some((line) => line.includes("scratch-repo")),
        "the rail never hydrated",
      ).toBe(true)
      // The daemon's receipt of that read: viewing the task cleared its inbox
      // episode, and the row status it publishes back rests at ○. Polled, not
      // raced: launch #2 must not start before the daemon has it.
      await poll(() => taskRow(screen()).includes(SEEN), 30_000)
      expect(taskRow(screen()), "launch #1 never saw its read reach the daemon").toContain(SEEN)
    })

    // Launch #2 must be a fresh process: nothing of launch #1 survives but the daemon.
    expect(alive(lastTuiPid), "launch #1 was still running before launch #2").toBe(false)

    // Between launches the user moves on: B is what the next launch opens, so
    // A's row is a session nobody is looking at.
    const moved = runRove(["api", "set-active", "--task-id", otherId], env)
    expect(moved.code, moved.stderr).toBe(0)

    // Launch #2 — the daemon replays the very same turn_complete it never
    // forgot, to a process that has viewed nothing yet.
    await withTui(async (screen) => {
      // Wait for that activity to reach the rail (the row leaves the "no
      // signal" glyph). Whether it lands on ● or ○ is the question below.
      await poll(() => {
        const row = taskRow(screen())
        return row.includes(SEEN) || row.includes(UNREAD)
      }, 30_000)
      const row = taskRow(screen())
      expect(row, "a completion already read came back unread after the restart").not.toContain(UNREAD)
      expect(row, "A's row never received the daemon's activity").toContain(SEEN)
    })
  }, 120_000)
})
