/**
 * `bun e2e/hero-routing.ts [--out=dir] [--speed=N] [--encode-only]` — record
 * the AUTO ROUTING demo through the sanctioned `/harness` path
 * (`hero-serve.ts` must be running), then encode it to `auto-routing.mp4` +
 * `auto-routing.gif`.
 *
 * What it films is one claim: a fan-out whose depth nobody chose. `rove api
 * add --count 4 --tier auto` hands the task's first sentence to the
 * classifier, the classifier answers `deep`, and all four siblings launch on
 * whatever the `deep` row of Settings → Auto routing names — each in its own
 * worktree, on its own branch, started together. The prompt is a real one
 * (`docs/design/auto-routing/jev-shots.json` shape: a symptom with no cause
 * and an instruction to go find it) and the verdict is a real request, not a
 * fixture value.
 *
 * ## The key, and where it is not
 *
 * The classifier needs a bearer token. Rove's own state is isolated in this
 * fixture, so `secretsPath()` resolves inside the throwaway home and the
 * operator's stored key is invisible to it — `hero-env.ts` therefore passes
 * the key through the ENVIRONMENT, which is the other place the product reads
 * one from. Three things follow, and all three are enforced rather than
 * remembered:
 *
 *   - it is never written into the fixture, a script, or a committed file;
 *   - it never reaches a command line, so `ps` cannot show it;
 *   - {@link forbidLiteral} registers it with the capture guard, so a take
 *     that renders it anywhere aborts instead of encoding.
 *
 * ## Why the CLI's own `.tierAuto` line is not on camera
 *
 * It would be the most direct evidence, and the only in-TUI surface that
 * could show it is a shell pane. A shell pane renders the operator's prompt,
 * which on this machine carries their e-mail address — the exact thing
 * `hero-capture.ts`'s guard exists to keep out of a published asset. So the
 * verdict reaches the screen the way the PRODUCT shows it: the engine pane of
 * a sibling names the model it launched with, and that model is the `deep`
 * row. The raw JSON is printed to this script's stdout for the PR body.
 *
 * ## Cost
 *
 * Not free, unlike `hero-kanban.ts` / `hero-routines.ts`: four siblings are
 * four real engine sessions. Two things keep it small — the fixture's routing
 * table points every row at a cheap model (the demo is about WHICH row is
 * chosen, not which model that row names), and the take ends as soon as the
 * four are up, because "they started together" is the whole claim. One
 * classifier request costs about $0.00003.
 *
 * Re-runnable: the four siblings are deleted after the take, so a re-shoot
 * starts from the same two rows the fixture seeds.
 */

import { mkdir, rm } from "node:fs/promises"
import { join, resolve } from "node:path"
import type { Page } from "@playwright/test"
import { REPO_ROOT, click, encode, forbidLiteral, look, press, record } from "./hero-capture.ts"
import { HERO_CLI, HERO_REPO, HERO_ROOT, heroEnv } from "./hero-env.ts"

const args = process.argv.slice(2)
const outDir = resolve(args.find((arg) => arg.startsWith("--out="))?.slice(6) ?? join(REPO_ROOT, "docs", "assets"))
const workDir = join(REPO_ROOT, ".scratch", "hero-routing")
/** Real seconds per delivered second. Matched to kanban/routines: this is read
 *  (four rows arriving, one pane's model), not skimmed. */
const SPEED = Number(args.find((arg) => arg.startsWith("--speed="))?.slice(8) ?? 3)

/**
 * The sentence the classifier is asked about.
 *
 * Deliberately the shape the rubric calls `deep`: a symptom, no cause offered,
 * and the work is to go find one. It is also about this fixture's own repo, so
 * the siblings have somewhere real to start. Verified against the live
 * classifier at 0.97 before this script was written.
 */
const PROMPT = "token refresh gets slower the longer the process runs — find out where the time goes"
const SIBLINGS = 4

/** Sidebar row centres at 1280×800 — see the probe stills in `hero-shot.ts`. */
const ROW = { firstTask: 136, firstSibling: 200 } as const

/** One row of the fan-out result. `addParallel` returns the handles the
 *  sidebar shows — not the task record, so the depth it landed on is read back
 *  with `get-task`. */
interface AddedTask {
  readonly taskId: string
  readonly title?: string
}

interface TaskRecord {
  readonly worktreePath?: string
  readonly tier?: string
  readonly model?: string
}

/** `rove api` through the BUILT cli, async so the capture's sensitive-text
 *  guard keeps running while a fan-out takes its ten seconds. */
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

/**
 * Register the classifier key with the capture guard.
 *
 * Read from the env `hero-env.ts` already assembled rather than from disk
 * again, so there is exactly one place that knows how the key is resolved.
 * Missing is a hard stop: the take would otherwise film `auto → no tier
 * (no-key…)`, which is a correct behaviour and the wrong demo.
 */
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

/**
 * Read back what each sibling actually landed on, and refuse to continue if
 * any of it escaped the fixture.
 *
 * The containment check is the one that matters: a worktree root is resolved
 * from the product home, and a capture that quietly created four checkouts in
 * the operator's real `~/.rove/worktrees` would be discovered weeks later.
 */
async function describeSiblings(tasks: readonly AddedTask[]): Promise<void> {
  for (const { taskId } of tasks) {
    const got = (await heroApiAsync(["get-task", "--task-id", taskId])) as { task?: TaskRecord }
    const path = got.task?.worktreePath
    if (path && !path.startsWith(HERO_ROOT)) {
      throw new Error(`task ${taskId} put its worktree at ${path}, outside the fixture root ${HERO_ROOT}`)
    }
    console.log(`[hero:routing]   ${taskId} tier=${got.task?.tier ?? "-"} model=${got.task?.model ?? "-"}`)
  }
}

/**
 * Close any non-engine tab the fixture is holding open.
 *
 * A shell tab renders the operator's shell prompt, which on a configured
 * machine carries their e-mail address — and `hero-capture.ts`'s guard aborts
 * the take when it sees one, correctly and after the fan-out has already been
 * paid for. One left open by hand while probing the layout cost exactly that,
 * so the recorder now clears them rather than trusting the fixture's state.
 */
async function closeShellTabs(): Promise<void> {
  const listed = (await heroApiAsync(["list"])) as { tasks?: { id: string }[] }
  for (const { id } of listed.tasks ?? []) {
    const got = (await heroApiAsync(["get-task", "--task-id", id])) as { tabs?: { id: string; kind: string }[] }
    for (const tab of got.tabs ?? []) {
      if (tab.kind === "engine") continue
      await heroApiAsync(["tab-close", "--task-id", id, "--tab", tab.id])
      console.log(`[hero:routing] closed ${id} ${tab.id} (${tab.kind}) — a shell pane renders the operator's prompt`)
    }
  }
}

const created: AddedTask[] = []

/** Leave the fixture as we found it, so the next shoot frames the same rows. */
async function removeSiblings(): Promise<void> {
  for (const { taskId } of created) {
    try {
      await heroApiAsync(["delete", "--task-id", taskId])
    } catch (error) {
      console.error(`[hero:routing] could not remove ${taskId}: ${String(error)}`)
    }
  }
  console.log(`[hero:routing] removed ${created.length} sibling(s) — fixture restored`)
}

async function storyboard(page: Page): Promise<void> {
  // Beat 0 — clear whatever the last take left on screen. Engine sessions are
  // hosted and survive a recording, so a take that ended on a dialog hands the
  // next one that dialog as its opening frame.
  await click(page, 80, ROW.firstTask)
  await page.waitForTimeout(1_500)
  await press(page, "esc")
  await page.waitForTimeout(2_500)

  // Beat 1 — the fan-out itself, fired while the camera watches the sidebar.
  // Nothing about the depth is typed: `--tier auto` is the whole instruction,
  // and the classifier reads the same sentence the engines are about to get.
  const result = (await heroApiAsync([
    "add",
    "--repo",
    HERO_REPO,
    "--count",
    String(SIBLINGS),
    "--tier",
    "auto",
    "--prompt",
    PROMPT,
  ])) as { tierAuto?: string; tasks?: AddedTask[]; failures?: unknown[] }

  created.push(...(result.tasks ?? []))
  // Printed, not filmed — see the header. This is what the PR quotes.
  console.log(`[hero:routing] ${result.tierAuto ?? "(no tierAuto reported)"}`)
  await describeSiblings(created)
  if (result.failures?.length) console.error(`[hero:routing] ${result.failures.length} sibling(s) failed to start`)

  // Beat 2 — four rows that were not there a moment ago, all on one branchpoint
  // and all starting at once. This is the beat the video exists for.
  await look(page, "token-refresh", 60_000)
  await page.waitForTimeout(6_000)

  // Beat 3 — one sibling opened. The engine pane's header names the model it
  // launched with, and that model is the `deep` row of the routing table — the
  // product's own rendering of a decision nobody typed.
  await click(page, 80, ROW.firstSibling)
  await page.waitForTimeout(7_000)

  // Beat 4 — back out to the four of them running side by side. The take ends
  // on the sidebar rather than on a transcript: what was routed is the subject,
  // not what any one engine went on to say.
  await click(page, 80, ROW.firstTask)
  await page.waitForTimeout(5_000)
}

if (!args.includes("--encode-only")) {
  guardTheKey()
  await closeShellTabs()
  await rm(workDir, { recursive: true, force: true })
  await mkdir(workDir, { recursive: true })
  try {
    await record(workDir, storyboard)
  } finally {
    await removeSiblings()
  }
}
// `startAt` drops the harness settling into the TUI — that frame is also the
// poster every embed shows before playback.
await encode({ workDir, outDir, name: "auto-routing", speed: SPEED, startAt: 1.5 })
