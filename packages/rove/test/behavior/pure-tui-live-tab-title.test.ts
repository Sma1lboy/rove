/**
 * Regression pin: a sidebar task row's NAME must track the live session, like
 * the state glyph beside it already does — not wait for you to click into that
 * task. A task is one conversation, so its row is named by that conversation's
 * title (over the task title and the branch).
 *
 * The OSC title only ever reached a tab through `useTabTurnState`, which is
 * mounted by `TerminalTabs` — and `TerminalTabs` exists only for the SELECTED
 * task. So every other row would render the persisted `lastTitle`: a recording
 * of whatever the tab was called the last time you were in it, sitting next to
 * a state glyph the daemon keeps live. One row, one live signal and one frozen
 * one.
 *
 * Shape: two tasks, focus pinned to A, and B's snapshot deliberately carrying
 * a STALE recording while B's engine publishes a different title. B is never
 * opened. The row must read the live title — which is only knowable from the
 * pty host, since nothing in this process ever attached to B.
 */

import { chmod, mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Terminal } from "@xterm/headless"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { SIDEBAR_WIDTH } from "../../src/tui/panes/sidebar/view-core.ts"
import {
  type BehaviorEnv,
  DIST_ROVE_CLI,
  applyTabOps,
  closeTui,
  loadNodePty,
  makeBehaviorEnv,
  makeScratchRepo,
  runRove,
} from "./harness.ts"

const nodePty = await loadNodePty()

const COLS = 140
const ROWS = 40
/** Prefix of what the fake engine publishes as its OSC 0 window title (suffixed with its cwd, so A and B differ). */
const LIVE = "LIVEX"
/** What B's snapshot claims the tab was called — the frozen recording. */
const STALE = "STALEX"

async function poll(predicate: () => boolean | Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

describe.skipIf(!nodePty)("Pure TUI sidebar shows an unselected task's live tab title (behavior)", () => {
  let env: BehaviorEnv
  let repo: string
  let statePath: string
  let taskA: string
  let taskB: string
  /** The title B's engine published, as the pty host observed it. */
  let liveTitleB = ""
  const branchA = "rove/pin-a"
  const branchB = "rove/pin-b"

  const readState = async (): Promise<Record<string, unknown>> =>
    JSON.parse(await readFile(statePath, "utf8")) as Record<string, unknown>

  beforeAll(async () => {
    env = await makeBehaviorEnv()

    // Local engine shim, overriding the harness default for THIS suite only:
    // same idle loop, plus one OSC 0 window title at startup. That title is
    // the whole subject of the test and no other suite should have to care.
    await writeFile(
      join(env.bin, "claude"),
      `#!/bin/sh\nprintf '\\033]0;${LIVE}-%s\\007' "$(basename "$PWD")"\necho "fake-claude ready $*"\nwhile :; do read -r _ignored || sleep 600; done\n`,
    )
    await chmod(join(env.bin, "claude"), 0o755)

    repo = await makeScratchRepo(env)
    const stateDir = join(env.home, ".config", "rove")
    await mkdir(stateDir, { recursive: true })
    statePath = join(stateDir, "state.json")
    // Both flags: `onboarded` alone means "the questions were asked" (it is
    // set before the wizard renders), not "the wizard finished". Without the
    // primer, this launch gets the wizard instead of the TUI.
    await writeFile(statePath, JSON.stringify({ onboarded: true, onboardedPrimer: true }))

    // `--prompt` takes the headless launch path: worktree + hosted engine
    // session under `<taskId>::tab-1`, plus the snapshot the TUI renders from.
    for (const branch of [branchA, branchB]) {
      const add = runRove(["api", "add", "--repo", repo, "--branch", branch, "--prompt", "hello"], env)
      expect(add.code, add.stderr).toBe(0)
      const id = (JSON.parse(add.stdout) as { task: { id: string } }).task.id
      if (branch === branchA) taskA = id
      else taskB = id
    }

    // Focus A, so the TUI boots into A and B's `TerminalTabs` never mounts —
    // the condition that made B's title go stale in the first place.
    const active = runRove(["api", "set-active", "--task-id", taskA], env)
    expect(active.code, active.stderr).toBe(0)

    await poll(() => {
      const sessions = JSON.parse(runRove(["api", "pty-list"], env).stdout) as {
        sessions?: { key: string; alive?: boolean; title?: string }[]
      }
      return (
        sessions.sessions?.some((s) => s.key === `${taskB}::tab-1` && s.alive && s.title?.startsWith(LIVE) === true) ===
        true
      )
    }, 30_000)
    const listed = JSON.parse(runRove(["api", "pty-list"], env).stdout) as {
      sessions?: { key: string; title?: string }[]
    }
    liveTitleB = listed.sessions?.find((s) => s.key === `${taskB}::tab-1`)?.title ?? ""
    expect(
      liveTitleB,
      "the pty host never observed the engine's OSC title — the test cannot say anything about the sidebar",
    ).toContain(LIVE)
  }, 180_000)

  afterAll(async () => {
    await env.dispose()
  })

  it("names B's row by its live title, though nobody opened it", async () => {
    if (!nodePty) throw new Error("unreachable: suite is skipped without node-pty")
    const key = `terminalTabs.${taskB}`

    // The frozen recording, in the shape the field one had: the tab was named
    // once, long ago, and nothing has re-mounted to refresh it since.
    const state = await readState()
    const snapshot = state[key] as { tabs: { id: string; lastTitle?: string | null }[] }
    expect(snapshot?.tabs?.[0]?.id, "B's snapshot never listed tab-1").toBe("tab-1")
    // Recorded through the daemon, the tabs' only writer.
    await applyTabOps(env, taskB, [{ op: "patch", id: "tab-1", set: { lastTitle: STALE } }])

    const term = new Terminal({ cols: COLS, rows: ROWS, allowProposedApi: true })
    // This child would inherit vitest's markers, and the host-session poll —
    // the whole delivery path under test — is off under a test RUNNER.
    const { VITEST, NODE_ENV, BUN_TEST, ...tuiEnv } = env.env as Record<string, string>
    const child = nodePty.spawn("bun", [DIST_ROVE_CLI], { cols: COLS, rows: ROWS, cwd: repo, env: tuiEnv })
    const data = child.onData((chunk: string) => term.write(chunk))
    const screen = (): string[] => {
      const buffer = term.buffer.active
      const lines: string[] = []
      for (let y = 0; y < ROWS; y++) lines.push(buffer.getLine(y)?.translateToString(true) ?? "")
      return lines
    }
    /** The rail rows that carry B's live title (the rail clips long names, so match its head). */
    const head = liveTitleB.slice(0, 12)
    const bRows = (): string[] =>
      screen()
        .map((line) => line.slice(0, SIDEBAR_WIDTH))
        .filter((line) => line.includes(head))

    try {
      // The sidebar polls the host every 2s, so the live title lands a tick
      // or two after the row does.
      await poll(() => bRows().length > 0, 30_000)

      const row = bRows()[0] ?? ""
      expect(row, "B's task row never showed the live session title").toContain(head)
      const rail = screen().map((line) => line.slice(0, SIDEBAR_WIDTH))
      expect(rail.join("\n"), "the rail is still rendering the frozen recording").not.toContain(STALE)

      // ...and B genuinely was a task nobody opened. A mounted `TerminalTabs`
      // RECORDS the live title it sees, so B's `lastTitle` still reading
      // STALE is the proof that the row above was drawn by the sidebar's own
      // path and not by the very component whose absence is the bug.
      const parked = (await readState())[key] as { tabs?: { lastTitle?: string | null }[] }
      expect(
        parked?.tabs?.[0]?.lastTitle,
        "B's TerminalTabs mounted after all — the assertions above prove nothing about the sidebar",
      ).toBe(STALE)
    } finally {
      data.dispose()
      await closeTui(child)
    }
  }, 120_000)
})
