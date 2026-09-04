/**
 * `bun e2e/hero-plugin-demos.ts [name…] [--out=dir] [--encode-only]` — record
 * the SDK example plugins through the sanctioned `/harness` path
 * (`hero-serve.ts` must be running against a fixture seeded by
 * `hero-plugins.ts`), one `<name>.mp4` + `<name>.gif` per example.
 *
 * These replace the earlier asciinema `demo.tape` GIFs, which filmed a bare
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
 * anything. Not idempotent in one respect: `hello-events` files a real issue
 * and `turn-notify` reports a real engine event, so re-shoot from
 * `hero-fixture.ts --fresh && hero-plugins.ts` for identical framing.
 */

import { mkdir, rm, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import type { Page } from "@playwright/test"
import { REPO_ROOT, click, encode, look, press, record } from "./hero-capture.ts"
import { HERO_HOME, HERO_REPO } from "./hero-env.ts"
import { heroApi } from "./hero-fixture.ts"

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
 * blank the run logs, and rewrite the settings-demo config.
 */
async function resetTakeState(): Promise<void> {
  // Split panes are HOSTED PTY sessions, and the PTY host is deliberately
  // independent of both the daemon and the TUI — a `::leaf-N` session
  // survives a take and the next TUI restores it, so an earlier take's Task
  // Board opens on top of the next one. `pane-close` cannot help here: it
  // broadcasts to an ATTACHED TUI, and between takes none is attached.
  // Killing the leaf process is what actually clears the layout; the engine
  // session (`::tab-1`, no `::leaf-`) is left alone so the workspace still
  // photographs as a live Claude Code.
  const sessions = (heroApi(["pty-list"]) as { sessions?: { key: string; pid?: number; alive?: boolean }[] }).sessions ?? []
  for (const session of sessions) {
    if (!session.key.includes("::leaf-") || !session.alive || !session.pid) continue
    try {
      process.kill(session.pid, "SIGTERM")
      console.log(`[hero:plugins] closed stale pane ${session.key}`)
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
  const tasks = (heroApi(["list"]) as { tasks?: { id: string; title: string }[] }).tasks ?? []
  for (const task of tasks) {
    if (task.title !== BOARD_TASK_TITLE) continue
    try {
      heroApi(["delete", "--task-id", task.id, "--force"])
      console.log(`[hero:plugins] dropped leftover task ${task.id}`)
    } catch {
      // Already gone, or a worktree that refuses: the next take just shows it.
    }
  }
}

const args = process.argv.slice(2)
const outDir = resolve(args.find((arg) => arg.startsWith("--out="))?.slice(6) ?? join(REPO_ROOT, "docs", "assets", "plugins"))

/**
 * Records each take CREATES, and so the reason a re-shoot is not idempotent.
 * Both are plain product records (a story, a task) with no cleanup hook: a
 * second run of the same take stacks another copy, and by the third pass the
 * board photographs as a list of duplicates. Re-shoot from a fresh fixture —
 * `hero-fixture.ts --fresh && hero-plugins.ts` — rather than trusting these
 * to be reused.
 */
const STORY_TITLE = "Retry rate limits with backoff"
const BOARD_TASK_TITLE = "Cache discovery documents"

/**
 * Both takes above file a record on camera and neither cleans up, so a
 * re-shoot on a used fixture stacks duplicates — five identical backlog
 * cards, two identical sidebar tasks. Always re-shoot from
 * `hero-fixture.ts --fresh && hero-plugins.ts`.
 */

/** Sidebar row centres at 1280×800: the repo's tasks sit under the pages. */
const ROW = { main: 152 } as const

/**
 * Reach Settings → Plugins the LONG way round, upward.
 *
 * `SECTIONS` is general → engines → plugins → keys → feedback → dev, and
 * `moveCursor` wraps, so `k` walks general → dev → feedback → keys → plugins:
 * four steps, none of them Engines. Stepping DOWN would cross Engines, which
 * renders the operator's real engine accounts — e-mail address, login state
 * and subscription — because `HOME` stays theirs for the whole capture (see
 * `hero-env.ts`). Selecting a section renders it immediately, so "passing
 * through" is the same as filming it; `hero-capture.ts` aborts a take that
 * shows one.
 *
 * Clicking the row was tried first and is worse: the rail's y-coordinates
 * shift with the fixture, and a click that lands one row high opens Engines
 * with no way to tell from the script that it did.
 */
async function openPluginsSection(page: Page): Promise<void> {
  await press(page, "k", "k", "k", "k") // general → dev → feedback → keys → plugins
  await page.waitForTimeout(800)
  await press(page, "l")
}

/**
 * Open the `main` task so a take has a live workspace to act in. Plugin panes
 * are workspace-scoped — `ctrl+e` does nothing while the sidebar holds focus,
 * and a task with no worktree renders "Select a task with a worktree", i.e. no
 * pane to split. The project-main task reuses the repo checkout, so this costs
 * no worktree and no quota.
 */
async function openWorkspace(page: Page): Promise<void> {
  await click(page, 40, ROW.main)
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
async function pickBackwards(page: Page, steps: number): Promise<void> {
  for (let step = 0; step < steps; step += 1) {
    await press(page, "left")
    await page.waitForTimeout(500)
  }
}

type Demo = {
  readonly name: string
  /** Real seconds per delivered second. */
  readonly speed: number
  readonly startAt?: number
  readonly storyboard: (page: Page) => Promise<void>
}

/**
 * GIF width. These render inline in `PLUGIN-AUTHORING.md` at reading size, and
 * a doc page that loads five of them pays for every pixel — 640 keeps the
 * Settings rows and the pane's task titles legible while roughly halving the
 * bytes against the 800 default.
 */
const GIF_WIDTH = 640

const DEMOS: readonly Demo[] = [
  {
    // `[[panes]]`: the plugin's own surface, drawn beside the engine.
    name: "task-board",
    speed: 2,
    startAt: 1.2,
    storyboard: async (page) => {
      await openWorkspace(page)

      // Beat 1 — the picker, where a plugin pane is offered next to the
      // engines. `Task Board` is the plugin's declared title, verbatim.
      await press(page, "ctrl+e")
      await look(page, "Task Board", 10_000)
      await page.waitForTimeout(3_000)

      // Beat 2 — pick it and let it split. Two steps back from `claude`
      // wraps past `scratch shell` onto the pane.
      await pickBackwards(page, 2)
      await page.waitForTimeout(1_200)
      await press(page, "enter")
      await look(page, "TASK BOARD", 20_000)
      await page.waitForTimeout(5_000)

      // Beat 3 — the board is LIVE, not a snapshot: a task created from
      // outside the TUI arrives over the `task.snapshot` channel the pane
      // subscribed to, and the pane redraws itself.
      heroApi(["add", "--repo", HERO_REPO, "--title", BOARD_TASK_TITLE])
      await look(page, BOARD_TASK_TITLE, 20_000)
      await page.waitForTimeout(6_000)
    },
  },
  {
    // `[[engines]]`: a manifest-only plugin contributing a coding CLI.
    name: "contrib-engine",
    speed: 2,
    startAt: 1.2,
    storyboard: async (page) => {
      await openWorkspace(page)

      // The whole claim is one frame: the engine list Rove offers now
      // carries an engine no Rove build ships. `fake-coder` is the id from
      // the plugin's `[[engines]]` table.
      await press(page, "ctrl+e")
      await look(page, "fake-coder", 10_000)
      await page.waitForTimeout(4_000)

      // Walk the ring onto it so the highlight names it, then hold. The take
      // stops short of launching: the example's command is a placeholder
      // `echo`, and filming it exit immediately would undersell the seam.
      await press(page, "right", "right", "right", "right", "right")
      await page.waitForTimeout(4_000)
      await press(page, "esc")
      await page.waitForTimeout(1_500)
    },
  },
  {
    // `[[settings]]` + `[[actions]]`: declared settings, edited by the host.
    name: "settings-demo",
    speed: 2,
    startAt: 1.2,
    storyboard: async (page) => {
      // Beat 1 — Settings → Plugins: every linked plugin, what it declares,
      // and the settings rows the manifest asked the host to render.
      await press(page, "ctrl+a")
      await page.waitForTimeout(600)
      await press(page, ",")
      await look(page, "Settings", 15_000)
      await page.waitForTimeout(2_000)
      await openPluginsSection(page)
      await look(page, "examples.settings-demo", 10_000)
      await page.waitForTimeout(4_000)

      // Beat 2 — walk down onto this plugin's own settings rows. The values
      // are the plugin's, the editors are Rove's.
      for (let step = 0; step < 5; step += 1) {
        await press(page, "j")
        await page.waitForTimeout(600)
      }
      await page.waitForTimeout(3_000)

      // Beat 3 — the enum row cycles through the options the manifest
      // declared, and the value reaches the plugin on its next run.
      await press(page, "enter")
      await page.waitForTimeout(2_500)
      await press(page, "esc")
      await page.waitForTimeout(2_500)
    },
  },
  {
    // `[[events]]`: a hook that runs because something happened in Rove.
    name: "hello-events",
    speed: 2,
    startAt: 1.2,
    storyboard: async (page) => {
      // Beat 1 — the plugin as the host sees it: two declared events, and a
      // run history that is still empty.
      await press(page, "ctrl+a")
      await page.waitForTimeout(600)
      await press(page, ",")
      await look(page, "Settings", 15_000)
      await page.waitForTimeout(1_500)
      await openPluginsSection(page)
      await look(page, "examples.hello-events", 10_000)
      await page.waitForTimeout(4_000)

      // Beat 2 — fire a real `issue.changed` from outside the TUI, exactly
      // as an agent would. The daemon dispatches it to the plugin's hook.
      heroApi(["issue-create", "--repo", HERO_REPO, "--title", STORY_TITLE])
      await page.waitForTimeout(4_000)

      // Beat 3 — leave the section and come back, which is what makes the
      // run appear. The Plugins section reads the registry ONCE per open
      // (`use-section-data.ts` keys its effect on `section`), so the row
      // never ticks over while it is on screen. `h` alone is not enough —
      // it only moves the cursor back to the section rail without changing
      // which section is open, so the effect does not re-run and the take
      // films a stale "never run". Switching to a DIFFERENT section and
      // back is the thing that re-reads.
      // Detour through Keybindings, the neighbour on the SAFE side, and come
      // back. Engines is the other neighbour; see `openPluginsSection`.
      await press(page, "h")
      await page.waitForTimeout(600)
      await press(page, "j") // → Keybindings
      await page.waitForTimeout(1_500)
      await press(page, "k") // → Plugins, re-read
      await page.waitForTimeout(1_200)
      await press(page, "l")
      await look(page, "issue.changed", 10_000)
      await page.waitForTimeout(5_000)

      // The take ENDS on the run summary rather than following the story onto
      // the board. The board beat was tried and dropped: the story this take
      // files is a real record with no cleanup, so each re-shoot stacks
      // another identical card and by the third pass the column photographs
      // as five copies of one title. The subject here is the hook that ran,
      // and that is already on screen.
      await press(page, "esc")
      await page.waitForTimeout(1_500)
    },
  },
  {
    // `[[events]]` + `notify()`: a hook calling back INTO the host UI.
    name: "turn-notify",
    speed: 2,
    startAt: 1.2,
    storyboard: async (page) => {
      await openWorkspace(page)

      // One beat, and it is the whole point: an engine turn completes, the
      // plugin's hook runs, and the toast on screen is the plugin's own copy
      // delivered through Rove's notification surface. `engine-report` is the
      // documented way a wrapper reports its own activity — the same RPC the
      // built-in hook adapters use, so nothing here is staged.
      const tasks = (heroApi(["list"]) as { tasks?: { id: string; title: string }[] }).tasks ?? []
      const task = tasks.find((candidate) => candidate.title === "orbit-sdk")
      if (!task) throw new Error("no project-main task to report a turn for")
      await page.waitForTimeout(2_000)
      heroApi(["engine-report", "--kind", "turn-complete", "--task-id", task.id])
      await look(page, "completed a turn", 20_000)
      await page.waitForTimeout(7_000)
    },
  },
]

const selected = args.filter((arg) => !arg.startsWith("--"))
const queue = selected.length > 0 ? DEMOS.filter((demo) => selected.includes(demo.name)) : DEMOS
if (queue.length === 0) throw new Error(`no such demo: ${selected.join(", ")}`)

for (const demo of queue) {
  const workDir = join(REPO_ROOT, ".scratch", `hero-plugin-${demo.name}`)
  if (!args.includes("--encode-only")) {
    await rm(workDir, { recursive: true, force: true })
    await mkdir(workDir, { recursive: true })
    await resetTakeState()
    console.log(`[hero:plugins] recording ${demo.name}`)
    await record(workDir, demo.storyboard)
  }
  await encode({
    workDir,
    outDir,
    name: demo.name,
    speed: demo.speed,
    gifWidth: GIF_WIDTH,
    ...(demo.startAt ? { startAt: demo.startAt } : {}),
  })
}
