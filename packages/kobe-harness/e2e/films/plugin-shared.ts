/**
 * What the five plugin demos (`task-board`, `contrib-engine`, `settings-demo`,
 * `hello-events`, `turn-notify`) share: the fixture state each take is shot
 * against, and the navigation every storyboard repeats.
 *
 * These record the SDK example plugins through the sanctioned `/harness` path
 * (`hero-serve.ts` running against a fixture seeded by `hero-plugins.ts`).
 * They replace the earlier asciinema `demo.tape` GIFs, which filmed a bare
 * shell running `rove api …` and `cat`-ing a log file: true, but no frame of
 * them contained the product. A plugin's claim is that it adds something to
 * ROVE, so each take is shot where that addition actually appears — the
 * `ctrl+e` picker, a split pane, the engine list, Settings → Plugins, a toast.
 *
 * Every example is linked BEFORE the harness boots (`hero-plugins.ts`): the
 * TUI reads the plugin registry once at start (`loadPluginEngines()` and the
 * pane/settings sections), so a plugin linked mid-take registers nothing the
 * running TUI can see. The storyboards only ever USE what is installed.
 *
 * Costs no engine quota beyond the one live `claude` session the workspace
 * takes are framed on, and that session is only a backdrop — no take asks it
 * anything. `hello-events` files a real issue and `task-board` creates a real
 * task; each film removes its own record in `afterTake`. `turn-notify` reports
 * a real engine event that stays in the daemon's log, so re-shoot from
 * `hero-fixture.ts --fresh && hero-plugins.ts` for identical framing.
 */

import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { Page } from "@playwright/test"
import { clickText, look, press } from "../hero-capture.ts"
import { HERO_HOME } from "../hero-env.ts"
import { heroApi } from "../hero-fixture.ts"
import type { Film } from "../film/film.ts"

/**
 * Records the takes CREATE. Both are plain product records (a story, a task)
 * with no cleanup hook of their own: a second run would stack another copy, and
 * by the third pass the board photographs as a list of duplicates.
 * {@link resetTakeState} drops the task; `hello-events` drops the story.
 */
export const STORY_TITLE = "Retry rate limits with backoff"
export const BOARD_TASK_TITLE = "Cache discovery documents"

/**
 * GIF width. These render inline in `PLUGIN-AUTHORING.md` at reading size, and
 * a doc page that loads five of them pays for every pixel — 640 keeps the
 * Settings rows and the pane's task titles legible while roughly halving the
 * bytes against the 800 default.
 */
export const GIF_WIDTH = 640

/**
 * Reset the daemon-side state each take is shot against.
 *
 * A take gets a fresh TUI (a new `/harness` PTY per run id), but the DAEMON
 * outlives it, and three things it owns survive into the next recording: the
 * task's tab layout (a Task Board split stays open, so the next take opens
 * with another plugin's pane already on screen), the plugin run log (a hook
 * fired by an earlier take reads as "last run … 2m ago", stealing the beat
 * where THIS take's event lands), and edited settings values. Each of those
 * turned up in the first pass — the `hello-events` take filmed a run summary
 * it had not caused.
 *
 * Cheap enough to do before every take: close the project-main task's tabs,
 * blank the run logs, and rewrite the settings-demo config. Each film runs it
 * first thing in its take AND as `afterTake`: the TUI is already booted when a
 * take starts, so the `afterTake` pass is what keeps the NEXT boot from
 * restoring this take's split.
 */
export async function resetTakeState(): Promise<void> {
  // Split panes are HOSTED PTY sessions, and the PTY host is deliberately
  // independent of both the daemon and the TUI — a `::leaf-N` session
  // survives a take and the next TUI restores it, so an earlier take's Task
  // Board opens on top of the next one. `pane-close` cannot help here: it
  // broadcasts to an ATTACHED TUI, and between takes none is attached.
  // Killing the leaf process is what actually clears the layout; the engine
  // session (`::tab-1`, no `::leaf-`) is left alone so the workspace still
  // photographs as a live Claude Code.
  const { sessions = [] }: { sessions?: { key: string; pid?: number; alive?: boolean }[] } = heroApi(["pty-list"])
  for (const session of sessions) {
    if (!session.key.includes("::leaf-") || !session.alive || !session.pid) continue
    try {
      process.kill(session.pid, "SIGTERM")
      console.log(`[film:plugins] closed stale pane ${session.key}`)
    } catch {
      // Already gone between the list and the kill: the state we wanted.
    }
  }
  for (const plugin of ["examples.hello-events", "examples.turn-notify", "examples.settings-demo", "examples.task-board"]) {
    const dir = join(HERO_HOME, ".rove", "plugins", plugin)
    await writeFile(join(dir, "log.jsonl"), "").catch(() => {})
    await writeFile(join(dir, "state", "events.jsonl"), "").catch(() => {})
  }
  await writeFile(
    join(HERO_HOME, ".rove", "plugins", "examples.settings-demo", "config", ".env"),
    "EX_DEMO_NAME=Orbit\nEX_DEMO_THEME=dark\nEX_DEMO_NOTIFY=1\n",
  ).catch(() => {})

  // Drop the task the task-board take creates on camera. It is a real record
  // with no cleanup of its own, so without this a second pass over the same
  // fixture leaves TWO identical sidebar rows and every later take is shot
  // against that. Deleting only this exact title leaves the fixture's own
  // tasks — and the live engine session — untouched.
  const { tasks = [] }: { tasks?: { id: string; title: string }[] } = heroApi(["list"])
  for (const task of tasks) {
    if (task.title !== BOARD_TASK_TITLE) continue
    try {
      heroApi(["delete", "--task-id", task.id, "--force"])
      console.log(`[film:plugins] dropped leftover task ${task.id}`)
    } catch {
      // Already gone, or a worktree that refuses: the next take just shows it.
    }
  }
}

/**
 * Reach Settings → Plugins WITHOUT passing through Engines.
 *
 * Engines renders the operator's real engine accounts — e-mail address, login
 * state and subscription — because `HOME` stays theirs for the whole capture
 * (see `hero-env.ts`). Selecting a section renders it immediately, so stepping
 * `j` down the rail from General would film it in passing. Clicking the row by
 * its text jumps straight there: a section rail gains entries (Auto routing and
 * Marketplace both landed after the first version of this took `k` four times
 * and ended on Marketplace), and a text lookup survives that where a key count
 * does not. The caller's `look(…)` for the plugin's own row is what proves the
 * click landed on Plugins.
 */
export async function openPluginsSection(page: Page): Promise<void> {
  await clickText(page, "Plugins")
  await page.waitForTimeout(800)
  await press(page, "l")
}

/**
 * Open the `main` task so a take has a live workspace to act in. Plugin panes
 * are workspace-scoped — `ctrl+e` does nothing while the sidebar holds focus,
 * and a task with no worktree renders "Select a task with a worktree", i.e. no
 * pane to split. The project-main task reuses the repo checkout, so this costs
 * no worktree and no quota.
 *
 * `▎main`, not `main`: the bar glyph starts every task row, and the bare word
 * also appears in the engine pane's paths.
 */
export async function openWorkspace(page: Page): Promise<void> {
  await clickText(page, "▎main")
  await look(page, "Claude Code", 30_000)
  await page.waitForTimeout(4_000)
}

/**
 * Walk the `ctrl+e` picker to a labelled choice. The picker is ONE ring
 * (`left`/`right` only — `down` is not bound and falls through to the pane
 * below), laid out over two display rows: engines and shell first, then
 * plugin panes. Plugin panes sit at the END, so wrapping backwards reaches
 * them in fewer strokes than walking the whole engine list.
 */
export async function pickBackwards(page: Page, steps: number): Promise<void> {
  for (let step = 0; step < steps; step += 1) {
    await press(page, "left")
    await page.waitForTimeout(500)
  }
}

/**
 * The shape every plugin demo shares: GIF-only at reading size, a cut that
 * opens on the first action (the recording before it is the harness settling
 * on an empty workspace) and plays at `rate`, and a reset before and after.
 */
export function pluginFilm(spec: {
  readonly name: string
  /** Real seconds per delivered second. */
  readonly rate: number
  readonly storyboard: Film["take"]
}): Film {
  return {
    name: spec.name,
    async take(page, cue) {
      await resetTakeState()
      await cue("open")
      await spec.storyboard(page, cue)
      await cue("end")
    },
    afterTake: resetTakeState,
    cut: [{ from: "open", to: "end", rate: spec.rate }],
    out: { gif: `docs/assets/plugins/${spec.name}.gif`, gifWidth: GIF_WIDTH },
  }
}
