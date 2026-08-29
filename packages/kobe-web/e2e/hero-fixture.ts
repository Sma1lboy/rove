/**
 * `bun e2e/hero-fixture.ts [--fresh]` -- build the README capture fixture:
 * an isolated Rove home, a realistic repo with history, and the sidebar's
 * idle tasks. Real engine sessions are started separately by `hero-seed.ts`
 * so a re-shoot can reuse the transcripts it already paid for.
 *
 * Nothing here touches the operator's `~/.rove`; see `hero-env.ts` for why
 * `HOME` is the one thing deliberately left alone.
 */

import { existsSync } from "node:fs"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { createTaskWithChatTab, runInFixture, runRoveApi, seedGitRepo } from "../../kobe/scripts/fixture-core.ts"
import { HERO_CLI, HERO_CONFIG, HERO_HOME, HERO_REPO, HERO_ROOT, KOBE_DIR, heroEnv } from "./hero-env.ts"
import { HERO_COMMITS, HERO_FILES } from "./hero-repo.ts"

const env = heroEnv()

export function heroRun(command: string, args: readonly string[], cwd: string = HERO_REPO): string {
  return runInFixture(command, args, cwd, env)
}

/** One `rove api` call through the BUILT cli, so prompt codas read `rove api ...`. */
export function heroApi(args: readonly string[]): Record<string, unknown> {
  return runRoveApi(HERO_CLI, args, HERO_REPO, env) as Record<string, unknown>
}

/**
 * Engine command for the capture. `acceptEdits` alone is not enough: the demo
 * prompts end in a commit and one of them asks for test coverage, and a bare
 * Bash call stops on an approval nobody is there to answer -- the turn never
 * finishes and the branch stays empty. Allowing exactly the two commands the
 * storyboard needs is the narrow fix; never `bypassPermissions`, which would
 * hand an unattended agent the operator's real HOME.
 *
 * `--setting-sources project --disable-slash-commands` keeps the operator's
 * USER-level configuration out of the session. `HOME` is deliberately theirs
 * (see `hero-env.ts`), which also means the engine would otherwise inherit
 * their global CLAUDE.md and every skill and plugin installed there -- enough
 * of a system prompt that the seed prompts came back `Prompt is too long` and
 * both turns stalled before writing a line. Auth still resolves from `HOME`;
 * only the configuration is scoped to this throwaway repo.
 */
const CLAUDE_COMMAND =
  'claude --permission-mode acceptEdits --allowedTools "Bash(git *)" "Bash(bun test*)" --setting-sources project --disable-slash-commands'

/**
 * Skill version this build expects, read off the BUILT skill (stamped in
 * lockstep with `KOBE_SKILL_VERSION`). Canonical `rove-` marker with the
 * legacy `kobe-` spelling, matching `parseSkillVersion` in the product.
 */
async function builtSkillVersion(): Promise<string | null> {
  try {
    const skill = await readFile(join(KOBE_DIR, "dist", "skills", "rove", "SKILL.md"), "utf8")
    return skill.match(/(?:rove|kobe)-skill-version:\s*(\d+)/)?.[1] ?? null
  } catch {
    return null
  }
}

async function seedSettings(): Promise<void> {
  const pkg = JSON.parse(await readFile(join(KOBE_DIR, "package.json"), "utf8")) as { version: string }
  const state: Record<string, unknown> = {
    "app.lastRunVersion": pkg.version,
    onboarded: true,
    skillHintSeen: "1",
    savedRepos: [HERO_REPO],
    defaultVendor: "claude",
    "engineCommand.claude": CLAUDE_COMMAND,
  }
  // `HOME` stays the operator's (see hero-env.ts), so an ALREADY-INSTALLED
  // skill that is merely behind this build takes the *stale* path, which is
  // gated on a version-keyed flag the unversioned one above does not answer.
  // Unseeded, the TUI opens on an interactive "update now? [y/n/d]" prompt
  // and never renders -- every capture then times out waiting for the sidebar.
  const skillVersion = await builtSkillVersion()
  if (skillVersion) state[`skillHintSeen:v${skillVersion}`] = "1"
  const dir = join(HERO_CONFIG, "rove")
  await mkdir(HERO_HOME, { recursive: true })
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, "state.json"), `${JSON.stringify(state, null, 2)}\n`)
}

async function seedRepo(): Promise<void> {
  await seedGitRepo(HERO_REPO, HERO_FILES, HERO_COMMITS, env, { email: "dev@orbit.local", name: "Orbit" })
}

/**
 * Sidebar depth. Each of these gets a chat tab, because a task WITHOUT one is
 * not a state the product normally shows: a task is created by starting a
 * session, so every row in a real sidebar has at least one tab nested under
 * it. Seeded bare, these two photographed as childless rows and the sidebar
 * read as a mock-up.
 *
 * Each opens with a SMALL prompt rather than a real piece of work: enough to
 * make the engine boot and register a tab, without paying for a turn whose
 * transcript nothing frames. The prompts differ per task on purpose — a tab's
 * sidebar label comes from its own first turn, so one shared prompt gives
 * every row the same child name and the tree reads as generated.
 */
const IDLE_TASKS: readonly { readonly title: string; readonly prompt: string }[] = [
  {
    title: "Port the docs snippets to the new client",
    prompt: "Which files under src/ does README.md reference? One line.",
  },
  {
    title: "Audit token refresh under clock skew",
    prompt: "What does src/session.ts cache, and until when? One line.",
  },
]

/** First message for the project-main row's tab — short by design. */
const MAIN_TAB_PROMPT = "What does this package export? One line."

/**
 * Routines for the automations still. Schedules sit in the small hours so a
 * capture session never trips one -- an enabled routine really does fire, and
 * a firing spends a real turn.
 */
const ROUTINES: readonly {
  readonly name: string
  readonly schedule: string
  readonly prompt: string
  readonly precheck?: string
  readonly disabled?: boolean
}[] = [
  {
    name: "Nightly dependency audit",
    schedule: "0 3 * * *",
    prompt: "Audit dependencies for advisories and open a branch with the safe upgrades.",
    precheck: "git log --since=24.hours -1 --oneline | grep .",
  },
  {
    name: "Weekly flaky-test hunt",
    schedule: "0 4 * * MON",
    prompt: "Run the suite ten times, find any test that is not deterministic, and fix it.",
  },
  {
    name: "Release notes draft",
    schedule: "0 5 * * FRI",
    prompt: "Draft release notes from this week's merged commits.",
    disabled: true,
  },
]

function seedRoutines(): void {
  for (const routine of ROUTINES) {
    const args = ["routine-create", "--repo", HERO_REPO, "--name", routine.name, "--schedule", routine.schedule, "--prompt", routine.prompt]
    if (routine.precheck) args.push("--precheck", routine.precheck)
    if (routine.disabled) args.push("--disabled")
    heroApi(args)
  }
}

async function main(): Promise<void> {
  const fresh = process.argv.includes("--fresh")
  if (fresh || !existsSync(HERO_REPO)) {
    if (existsSync(HERO_HOME)) {
      try {
        heroRun("bun", [HERO_CLI, "daemon", "stop"], KOBE_DIR)
      } catch {
        // no daemon to stop
      }
    }
    await rm(HERO_ROOT, { recursive: true, force: true })
    await mkdir(HERO_HOME, { recursive: true })
    await seedSettings()
    await seedRepo()
    for (const task of IDLE_TASKS) {
      createTaskWithChatTab(HERO_CLI, { title: task.title, repo: HERO_REPO, prompt: task.prompt }, HERO_REPO, env)
    }
    // The project-main row derives from `savedRepos` rather than being created
    // here, and the daemon usually opens a tab against the reused checkout
    // automatically. Send only when it somehow has none: prompting a row that
    // already has a tab gives it a second identical engine child, which is as
    // unlike a real sidebar as having none at all.
    const mainTask = ((heroApi(["list"]) as { tasks?: { id: string; kind?: string }[] }).tasks ?? []).find(
      (task) => task.kind === "main",
    )
    if (mainTask) {
      const tabs = (heroApi(["get-task", "--task-id", mainTask.id]) as { tabs?: unknown[] }).tabs ?? []
      if (tabs.length === 0) heroApi(["send", "--task-id", mainTask.id, "--plain", "--prompt", MAIN_TAB_PROMPT])
    }
    seedRoutines()
  }
  const listed = heroApi(["list"]) as { tasks?: unknown[] }
  console.log(`[hero] home ${HERO_HOME}`)
  console.log(`[hero] repo ${HERO_REPO} · ${listed.tasks?.length ?? 0} task(s)`)
}

if (import.meta.main) await main()
