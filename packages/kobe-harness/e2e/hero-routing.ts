/**
 * `bun e2e/hero-routing.ts [--dry-run] [--out=dir] [--speed=N] [--encode-only]`
 * — record the AUTO ROUTING demo through the sanctioned `/harness` path
 * (`hero-serve.ts` must be running), then encode it to `auto-routing.mp4` +
 * `auto-routing.gif`.
 *
 * The take has to put three facts ON SCREEN, in order, and each beat below
 * exists for one of them:
 *
 *   1. nobody chose a depth — the command is typed in a shell pane on camera,
 *      and the only depth word in it is `--tier auto`;
 *   2. the classifier chose one — the same pane prints the CLI's own verdict,
 *      `auto → deep (confidence …)`, the moment the fan-out returns;
 *   3. all four siblings run on what `deep` names — Settings → Auto routing is
 *      shown first so the viewer knows what `deep` points at, and then two of
 *      the new siblings are opened, where the engine's own header names the
 *      model it launched with.
 *
 * An earlier cut of this file filmed the sidebar gaining four rows and
 * called it a routing demo: the verdict lived only in this script's stdout,
 * and the one sibling it opened was on screen for two seconds with nothing
 * saying why it mattered. Four new rows prove a fan-out, not a decision.
 *
 * ## The shell pane
 *
 * `hero-env.ts` gives the fixture its own `ZDOTDIR` (plain prompt) and a
 * `rove` that is this branch's build. Without the first, the pane renders the
 * operator's own prompt — which carries their account — and the capture
 * guard aborts the take; without the second, `rove` is whatever version the
 * operator has installed.
 *
 * ## The key, and where it is not
 *
 * The classifier needs a bearer token and the fixture's Rove home is
 * isolated, so `hero-env.ts` passes it through the environment — the other
 * place the product reads one from. It is never written to a file or a
 * command line, and {@link forbidLiteral} registers it with the capture
 * guard, so a take that renders it aborts instead of encoding.
 *
 * ## Cost, and the dry run
 *
 * A real take is one classifier request (~$0.00003) and four engine sessions
 * on the `deep` row, which the fixture points at a cheap model — the claim is
 * WHICH row is chosen. `--dry-run` spends none of the engine half: it points
 * `deep` at a stand-in engine that only echoes its input, records to `.scratch`, and
 * skips the encode, so every beat can be checked frame by frame before a take
 * that costs anything. The classifier call is still real in a dry run, which
 * is the point — beat 2 is its answer.
 *
 * Re-runnable: the four siblings and the shell tab are removed after the take.
 */

import { readFileSync, writeFileSync } from "node:fs"
import { mkdir, rm } from "node:fs/promises"
import { join, resolve } from "node:path"
import type { Page } from "@playwright/test"
import { REPO_ROOT, click, encode, forbidLiteral, look, press, record } from "./hero-capture.ts"
import { HERO_CLI, HERO_CONFIG, HERO_REPO, HERO_ROOT, heroEnv } from "./hero-env.ts"

const args = process.argv.slice(2)
const DRY_RUN = args.includes("--dry-run")
const outDir = resolve(args.find((arg) => arg.startsWith("--out="))?.slice(6) ?? join(REPO_ROOT, "docs", "assets"))
const workDir = join(REPO_ROOT, ".scratch", DRY_RUN ? "hero-routing-dry" : "hero-routing")
/** Real seconds per delivered second. Matched to kanban/routines: this is read
 *  (a table, a verdict, a model name), not skimmed. */
const SPEED = Number(args.find((arg) => arg.startsWith("--speed="))?.slice(8) ?? 3)

/**
 * The sentence the classifier is asked about: a symptom, no cause offered,
 * and the work is to go find one — the shape the rubric calls `deep`. About
 * this fixture's own repo, so the siblings have somewhere real to start.
 * Verified against the live classifier at 0.97.
 */
const PROMPT = "token refresh gets slower the longer the process runs — find out where the time goes"
const SIBLINGS = 4

/** What is typed on camera. `--repo .` resolves a task worktree to its main
 *  checkout, so the line stays short; `jq` keeps the verdict legible instead
 *  of burying it at the bottom of forty lines of JSON. */
const COMMAND = `rove api add --repo . --count ${SIBLINGS} --tier auto --prompt '${PROMPT}' | jq '{tierAuto, count}'`

/** The sidebar title a sibling gets — hyphenated, so it cannot match the
 *  spaced prompt text inside the shell pane. */
const SIBLING_ROW = "token-refresh-gets"

/** Sidebar row centre of the fixture's first task at 1280×800. */
const FIRST_TASK_Y = 136
/** Settings' own section list at 1280×800: General 56, Engines 88, Auto
 *  routing 120. */
const SETTINGS_AUTO_ROUTING_Y = 120
/** Terminal cell height at 1280×800 — sidebar rows sit 16px apart. */
const CELL = 16

/**
 * The fixture's routing table for this take.
 *
 * Real: every row on Claude, `deep` on a stronger model than the other two so
 * the header shot says something. Dry: `deep` on a stand-in engine that only
 * echoes its input — no model, because a custom engine declares no model flag and the
 * tier gate would (correctly) refuse one.
 */
function seedRouting(): void {
  const path = join(HERO_CONFIG, "rove", "state.json")
  const state = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>
  Object.assign(state, {
    "autoRouting.classifier": "jev",
    "autoRouting.classifierThreshold": 0.5,
    "autoRouting.swift.engine": "claude",
    "autoRouting.swift.model": "haiku",
    "autoRouting.standard.engine": "claude",
    "autoRouting.standard.model": "haiku",
  })
  // The engine picker opens on the repo's LAST-USED engine, which outranks
  // `defaultVendor` — and a take that ever lands on the wrong choice records
  // that wrong choice as the new starting point. Clearing it here puts the
  // highlight on `claude`, the first choice, every time.
  for (const key of Object.keys(state)) if (key.startsWith("lastActiveVendor.")) delete state[key]
  state.defaultVendor = "claude"
  const custom = new Set((state.customEngineIds as string[] | undefined) ?? [])
  if (DRY_RUN) {
    custom.add("standin")
    Object.assign(state, {
      customEngineIds: [...custom],
      "engineName.standin": "Stand-in",
      // `cat`, not `sleep`: the fan-out delivers the prompt and waits to see it
      // land, and a process that never reads its input would make the dry run
      // report a delivery failure the real take would not have.
      "engineCommand.standin": "sh -c 'echo stand-in engine: no model, no quota; exec cat'",
      "autoRouting.deep.engine": "standin",
      "autoRouting.deep.model": "",
    })
  } else {
    custom.delete("standin")
    state.customEngineIds = [...custom]
    delete state["engineName.standin"]
    delete state["engineCommand.standin"]
    Object.assign(state, { "autoRouting.deep.engine": "claude", "autoRouting.deep.model": "sonnet" })
  }
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`)
}

/** `rove api` through the BUILT cli, async so the capture's sensitive-text
 *  guard keeps running while a call is in flight. */
async function heroApiAsync(argv: readonly string[]): Promise<Record<string, unknown>> {
  const child = Bun.spawn(["bun", HERO_CLI, "api", ...argv], {
    cwd: HERO_REPO,
    env: heroEnv(),
    stdout: "pipe",
    stderr: "pipe",
  })
  const [out, err] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()])
  await child.exited
  try {
    return JSON.parse(out) as Record<string, unknown>
  } catch {
    throw new Error(`rove api ${argv[0]} did not return JSON: ${out.slice(0, 400)}${err.slice(0, 400)}`)
  }
}

/** Register the classifier key with the capture guard. Missing is a hard stop:
 *  the take would film `auto → no tier (no-key…)` — correct, and the wrong demo. */
function guardTheKey(): void {
  const key = heroEnv().TYPESAFE_API_KEY?.trim()
  if (!key) {
    throw new Error(
      "no TYPESAFE_API_KEY for the classifier — export it, or store it with Settings → Auto routing → API key " +
        "(it lands in ~/.rove/secrets.json, which hero-env.ts reads). The take needs a real verdict.",
    )
  }
  forbidLiteral(key)
}

/** Close every non-engine tab, so the take starts from the fixture's own rows. */
async function closeShellTabs(): Promise<void> {
  const listed = (await heroApiAsync(["list"])) as { tasks?: { id: string }[] }
  for (const { id } of listed.tasks ?? []) {
    const got = (await heroApiAsync(["get-task", "--task-id", id])) as { tabs?: { id: string; kind: string }[] }
    for (const tab of got.tabs ?? []) {
      if (tab.kind === "engine") continue
      await heroApiAsync(["tab-close", "--task-id", id, "--tab", tab.id])
    }
  }
}

/** The tasks that existed before the take, so the ones it created can be
 *  found — and only those removed — afterwards. */
async function taskIds(): Promise<Set<string>> {
  const listed = (await heroApiAsync(["list"])) as { tasks?: { id: string }[] }
  return new Set((listed.tasks ?? []).map((task) => task.id))
}

/**
 * Read back what each new sibling landed on, and refuse to continue if any
 * worktree escaped the fixture — the failure nobody would notice for weeks.
 */
async function describeSiblings(before: Set<string>): Promise<string[]> {
  const created = [...(await taskIds())].filter((id) => !before.has(id))
  for (const id of created) {
    const got = (await heroApiAsync(["get-task", "--task-id", id])) as {
      task?: { worktreePath?: string; tier?: string; model?: string; command?: string }
    }
    const path = got.task?.worktreePath
    if (path && !path.startsWith(HERO_ROOT)) {
      throw new Error(`task ${id} put its worktree at ${path}, outside the fixture root ${HERO_ROOT}`)
    }
    console.log(
      `[hero:routing]   ${id} tier=${got.task?.tier ?? "-"} engine=${got.task?.command ?? "-"} model=${got.task?.model ?? "-"}`,
    )
  }
  return created
}

/**
 * Where on screen the Nth row containing `needle` is, from the harness's
 * own text mirror of the terminal — so a click lands on a sibling by what it
 * SAYS rather than by a coordinate that shifts whenever a row is added above.
 */
async function rowY(page: Page, needle: string, nth = 0): Promise<number | null> {
  const text = (await page.getByTestId("opentui-buffer").textContent()) ?? ""
  const rows = text.split("\n")
  let seen = 0
  for (let i = 0; i < rows.length; i += 1) {
    if (!rows[i]?.includes(needle)) continue
    if (seen === nth) return i * CELL + CELL / 2
    seen += 1
  }
  return null
}

/**
 * `look`, but fatal. For the one precondition a wrong guess cannot survive:
 * the command is about to be TYPED, and if the pane under the cursor is an
 * engine rather than a shell, the text becomes an instruction to an
 * unattended agent. A dry run of this file did exactly that — the picker
 * landed on opencode, and opencode read the line as a task and ran it.
 */
async function mustSee(page: Page, needles: readonly string[], timeout: number): Promise<void> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const text = (await page.getByTestId("opentui-buffer").textContent()) ?? ""
    if (needles.some((needle) => text.includes(needle))) return
    await page.waitForTimeout(500)
  }
  throw new Error(`precondition failed: none of ${JSON.stringify(needles)} appeared — refusing to type into this pane`)
}

/** The fixture shell's prompt for each task worktree — `%1~ $ ` in the
 *  capture `.zshrc`, so the worktree's own directory name. */
async function shellPrompts(): Promise<string[]> {
  const listed = (await heroApiAsync(["list"])) as { tasks?: { worktreePath?: string }[] }
  return (listed.tasks ?? [])
    .map((task) => task.worktreePath?.split("/").pop())
    .filter((name): name is string => Boolean(name))
    .map((name) => `${name} $ `)
}

async function openSibling(page: Page, nth: number): Promise<void> {
  const y = await rowY(page, SIBLING_ROW, nth)
  if (y === null) {
    console.error(`[hero:routing] sibling row ${nth} not on screen — beat skipped`)
    return
  }
  await click(page, 80, y)
}

let PROMPTS: readonly string[] = []

async function storyboard(page: Page): Promise<void> {
  // Beat 0 — clear whatever the last take left on screen.
  await press(page, "esc")
  await page.waitForTimeout(1_500)

  // Beat 1 — what `deep` points at, before anything is routed to it. Without
  // this, the model name in beat 4 is just a model name.
  await press(page, "ctrl+a", ",")
  await look(page, "Settings", 10_000)
  // CLICKED, not reached with `down`: the section between General and Auto
  // routing is Engines, which renders the operator's logged-in account, and
  // stepping through it for a few hundred milliseconds is enough for the
  // capture guard to (correctly) refuse the take.
  await click(page, 60, SETTINGS_AUTO_ROUTING_Y)
  await mustSee(page, ["Choose with"], 10_000)
  // Long enough to READ at 3×: the table is what gives beat 4 its meaning.
  await page.waitForTimeout(12_000)
  await press(page, "esc")
  await page.waitForTimeout(1_200)

  // Beat 2 — a shell in the first task's worktree, from the same picker a user
  // opens one with. The prompt is the fixture's own, not the operator's.
  await click(page, 80, FIRST_TASK_Y)
  await press(page, "enter")
  await page.waitForTimeout(1_500)
  await press(page, "ctrl+e")
  // Fatal, like every check before the fan-out: nothing has been spent yet,
  // so a take missing a beat should stop here rather than film on. A dry run
  // whose `ctrl+e` landed outside the task pane pressed `enter` into the
  // wrong place and opened an engine tab nobody asked for.
  await mustSee(page, ["New conversation"], 10_000)
  // The picker wraps, `scratch shell` is always LAST and `shell` sits just
  // before it — so two steps left of the first choice is `shell` however many
  // engines are installed. Counting right from the front is what broke: a
  // stand-in engine in the list moved every choice after it by one.
  await press(page, "left", "left")
  await press(page, "enter")
  await mustSee(page, PROMPTS, 15_000)
  await page.waitForTimeout(1_000)

  // Beat 3 — the fan-out, typed where the viewer can read it. `--tier auto` is
  // the only thing it says about depth; the verdict prints in the same pane.
  //
  // Entered as ONE input event rather than keystroke by keystroke: through the
  // recording browser each key costs a full render round-trip, and a 165-
  // character line took thirty-six seconds — a third of the finished video
  // spent watching letters appear. The line still arrives through xterm and
  // the PTY exactly as a paste would, and nothing is submitted until all of it
  // is confirmed on screen.
  await page.keyboard.insertText(COMMAND)
  await mustSee(page, ["'{tierAuto, count}'"], 10_000)
  await page.waitForTimeout(3_000)
  await press(page, "enter")
  await look(page, "auto → ", 120_000)
  await page.waitForTimeout(12_000)

  // Beat 4 — open a sibling: the engine's own header names the model it
  // launched with, and beat 1 showed that model is the `deep` row.
  await openSibling(page, 0)
  await look(page, DRY_RUN ? "stand-in engine" : "Sonnet", 30_000)
  await page.waitForTimeout(10_000)

  // Beat 5 — and another, because the claim is about all four.
  await openSibling(page, 1)
  await look(page, DRY_RUN ? "stand-in engine" : "Sonnet", 30_000)
  await page.waitForTimeout(8_000)
}

if (!args.includes("--encode-only")) {
  guardTheKey()
  seedRouting()
  await closeShellTabs()
  PROMPTS = await shellPrompts()
  const before = await taskIds()
  await rm(workDir, { recursive: true, force: true })
  await mkdir(workDir, { recursive: true })
  let created: string[] = []
  try {
    await record(workDir, storyboard)
  } finally {
    created = await describeSiblings(before)
    for (const id of created) {
      try {
        await heroApiAsync(["delete", "--task-id", id])
      } catch (error) {
        console.error(`[hero:routing] could not remove ${id}: ${String(error)}`)
      }
    }
    await closeShellTabs()
    console.log(`[hero:routing] removed ${created.length} sibling(s) and the shell tab — fixture restored`)
  }
}
if (DRY_RUN) {
  console.log(`[hero:routing] dry run: take left in ${workDir}, nothing encoded`)
} else {
  // `startAt` drops the harness settling into the TUI — that frame is also
  // the poster every embed shows before playback.
  await encode({ workDir, outDir, name: "auto-routing", speed: SPEED, startAt: 1.5 })
}
