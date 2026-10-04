/**
 * The AUTO ROUTING demo. `hero-serve.ts` must be running, and the take needs
 * `prepareAutoRouting()` to run BEFORE the TUI boots (`e2e/film.ts take` does
 * that): the TUI reads the routing table at start.
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
 * An earlier cut filmed the sidebar gaining four rows and called it a routing
 * demo: the verdict lived only in the script's stdout, and the one sibling it
 * opened was on screen for two seconds with nothing saying why it mattered.
 * Four new rows prove a fan-out, not a decision.
 *
 * ## The shell pane
 *
 * `hero-env.ts` gives the fixture its own `ZDOTDIR` (plain prompt) and a
 * `rove` that is this branch's build. Without the first, the pane renders the
 * operator's own prompt — which carries their account — and the take's
 * redaction pass aborts it; without the second, `rove` is whatever version the
 * operator has installed.
 *
 * ## The key, and where it is not
 *
 * The classifier needs a bearer token and the fixture's Rove home is
 * isolated, so `hero-env.ts` passes it through the environment — the other
 * place the product reads one from. It is never written to a file or a
 * command line, and {@link forbidLiteral} registers it so a take that renders
 * it aborts instead of saving a cast.
 *
 * ## Cost, and the dry run
 *
 * A real take is one classifier request (~$0.00003) and four engine sessions
 * on the `deep` row, which the fixture points at a cheap model — the claim is
 * WHICH row is chosen. `ROUTING_DRY_RUN=1` spends none of the engine half: it
 * points `deep` at a stand-in engine that only echoes its input, so every beat
 * can be checked frame by frame before a take that costs anything. The
 * classifier call is still real in a dry run, which is the point — beat 2 is
 * its answer. A dry-run cast is scratch: copy it out of `e2e/films/` and
 * delete it, never commit it.
 *
 * Re-runnable: the four siblings and the shell tab are removed after the take.
 */

import { readFileSync, writeFileSync } from "node:fs"
import type { Page } from "@playwright/test"
import { clickText, look, press } from "../hero-capture.ts"
import { HERO_CLI, HERO_CONFIG, HERO_REPO, HERO_ROOT, heroEnv } from "../hero-env.ts"
import { forbidLiteral } from "../film/take.ts"
import type { Film } from "../film/film.ts"
import { join } from "node:path"

const DRY_RUN = process.env.ROUTING_DRY_RUN === "1"

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
  const state: Record<string, unknown> = JSON.parse(readFileSync(path, "utf8"))
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
  const custom = new Set(Array.isArray(state.customEngineIds) ? state.customEngineIds : [])
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

/** `rove api` through the BUILT cli, async so the page's own work keeps
 *  running while a call is in flight. */
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
    return JSON.parse(out)
  } catch {
    throw new Error(`rove api ${argv[0]} did not return JSON: ${out.slice(0, 400)}${err.slice(0, 400)}`)
  }
}

/** Register the classifier key so a take that renders it aborts. Missing is a
 *  hard stop: the take would film `auto → no tier (no-key…)` — correct, and
 *  the wrong demo. */
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

type Listed = { tasks?: { id: string; worktreePath?: string }[] }

/** Close every non-engine tab, so the take starts from the fixture's own rows. */
async function closeShellTabs(): Promise<void> {
  const listed: Listed = await heroApiAsync(["list"])
  for (const { id } of listed.tasks ?? []) {
    const got: { tabs?: { id: string; kind: string }[] } = await heroApiAsync(["get-task", "--task-id", id])
    for (const tab of got.tabs ?? []) {
      if (tab.kind === "engine") continue
      await heroApiAsync(["tab-close", "--task-id", id, "--tab", tab.id])
    }
  }
}

/** The tasks that existed before the take, so the ones it created can be
 *  found — and only those removed — afterwards. */
async function taskIds(): Promise<Set<string>> {
  const listed: Listed = await heroApiAsync(["list"])
  return new Set((listed.tasks ?? []).map((task) => task.id))
}

/**
 * Read back what each new sibling landed on, and refuse to continue if any
 * worktree escaped the fixture — the failure nobody would notice for weeks.
 */
async function describeSiblings(before: Set<string>): Promise<string[]> {
  const created = [...(await taskIds())].filter((id) => !before.has(id))
  for (const id of created) {
    const got: { task?: { worktreePath?: string; tier?: string; model?: string; command?: string } } =
      await heroApiAsync(["get-task", "--task-id", id])
    const path = got.task?.worktreePath
    if (path && !path.startsWith(HERO_ROOT)) {
      throw new Error(`task ${id} put its worktree at ${path}, outside the fixture root ${HERO_ROOT}`)
    }
    console.log(
      `[film:auto-routing]   ${id} tier=${got.task?.tier ?? "-"} engine=${got.task?.command ?? "-"} model=${got.task?.model ?? "-"}`,
    )
  }
  return created
}

/**
 * `look`, but fatal. For the one precondition a wrong guess cannot survive:
 * the command is about to be TYPED, and if the pane under the cursor is an
 * engine rather than a shell, the text becomes an instruction to an
 * unattended agent. A dry run of the first version did exactly that — the
 * picker landed on opencode, and opencode read the line as a task and ran it.
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
  const listed: Listed = await heroApiAsync(["list"])
  return (listed.tasks ?? [])
    .map((task) => task.worktreePath?.split("/").pop())
    .filter((name): name is string => Boolean(name))
    .map((name) => `${name} $ `)
}

async function openSibling(page: Page, nth: number): Promise<void> {
  try {
    await clickText(page, SIBLING_ROW, 0, { nth })
  } catch {
    console.error(`[film:auto-routing] sibling row ${nth} not on screen — beat skipped`)
  }
}

/** Filled by {@link prepareAutoRouting}, read by the take and its cleanup. */
let PROMPTS: readonly string[] = []
let tasksBefore = new Set<string>()

/**
 * Everything that must be true before the TUI boots: the key is present, the
 * routing table is seeded, no stray shell tab is open, and the pre-existing
 * tasks are recorded so the siblings can be told apart afterwards.
 */
export async function prepareAutoRouting(): Promise<void> {
  guardTheKey()
  seedRouting()
  await closeShellTabs()
  PROMPTS = await shellPrompts()
  tasksBefore = await taskIds()
}

async function removeSiblings(): Promise<void> {
  const created = await describeSiblings(tasksBefore)
  for (const id of created) {
    try {
      await heroApiAsync(["delete", "--task-id", id])
    } catch (error) {
      console.error(`[film:auto-routing] could not remove ${id}: ${String(error)}`)
    }
  }
  await closeShellTabs()
  console.log(`[film:auto-routing] removed ${created.length} sibling(s) and the shell tab — fixture restored`)
}

async function storyboard(page: Page, cue: Parameters<Film["take"]>[1]): Promise<void> {
  // Beat 0 — clear whatever the last take left on screen.
  await press(page, "esc")
  await page.waitForTimeout(1_500)
  // The cut opens here: the harness settling into the TUI before this is
  // also what every embed would show as its poster.
  await cue("open")

  // Beat 1 — what `deep` points at, before anything is routed to it. Without
  // this, the model name in beat 4 is just a model name.
  await press(page, "ctrl+a", ",")
  await look(page, "Settings", 10_000)
  // CLICKED, not reached with `down`: the section between General and Auto
  // routing is Engines, which renders the operator's logged-in account, and
  // stepping through it for a few hundred milliseconds is enough for the
  // redaction pass to (correctly) refuse the take.
  await clickText(page, "Auto routing")
  await mustSee(page, ["Choose with"], 10_000)
  // Long enough to READ at 3×: the table is what gives beat 4 its meaning.
  await page.waitForTimeout(12_000)
  await press(page, "esc")
  await page.waitForTimeout(1_200)

  // Beat 2 — a shell in the project-main task's checkout, from the same picker
  // a user opens one with. The prompt is the fixture's own, not the operator's.
  await clickText(page, "▎main")
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
  await cue("end")
}

export const autoRouting: Film = {
  name: "auto-routing",
  async take(page, cue) {
    try {
      await storyboard(page, cue)
    } catch (error) {
      // `afterTake` only runs once a cast was saved; a failed take must still
      // not leave four siblings on the fixture.
      await removeSiblings()
      throw error
    }
  },
  afterTake: removeSiblings,
  // Matched to kanban/routines: this is read (a table, a verdict, a model
  // name), not skimmed.
  cut: [{ from: "open", to: "end", rate: 3 }],
  out: { mp4: "docs/assets/auto-routing.mp4", gif: "docs/assets/auto-routing.gif" },
}
