/**
 * The handoff film: one task started on Claude Code, which runs out of quota mid-turn; the task
 * continues on Codex, which hands the tests to another agent; the terminal is closed and reopened
 * on the Inbox.
 *
 *   bun e2e/films/quota-proxy.ts                                      # keep running
 *   HERO_ROOT=/tmp/rove-demo bun e2e/film.ts setup handoff
 *   HERO_ROOT=/tmp/rove-demo bun e2e/hero-serve.ts                    # keep running
 *   HERO_ROOT=/tmp/rove-demo bun e2e/film.ts take handoff             # REAL turns
 *
 * Claude Code talks to the quota proxy (`HERO_ANTHROPIC_BASE_URL`, default the proxy's port) with
 * `HERO_ANTHROPIC_AUTH_TOKEN`; the take creates the proxy's trip file once Claude has edited a
 * file, and the next model request is refused as a spent usage window. Everything after that is
 * unscripted: Rove's own strip offers the other engine, and Codex does the rest.
 */

import { existsSync } from "node:fs"
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { Page } from "@playwright/test"
import { runRoveApi, seedGitRepo, writeFixtureWebToken } from "../../../rove/scripts/fixture-core.ts"
import type { Cue, Film } from "../film/film.ts"
import { clickText, look, press } from "../hero-capture.ts"
import { HERO_CLI, HERO_CONFIG, HERO_HOME, HERO_ROOT, heroEnv, ROVE_DIR, stopHeroStack } from "../hero-env.ts"
import { HERO_COMMITS, HERO_FILES } from "../hero-repo.ts"

const env = heroEnv()
const REPO = join(HERO_ROOT, "orbit-sdk")
const TRIP = process.env.QUOTA_PROXY_TRIP ?? "/tmp/rove-quota-trip"
/**
 * Each engine gets a config home inside the fixture, so the take never reads the operator's
 * memories, skills or transcripts and none of their paths reach the screen. Export the same two
 * variables for `setup`, `hero-serve.ts` and `take`: Rove resolves transcripts and hooks from them.
 */
const CLAUDE_HOME = join(HERO_ROOT, "claude")
const CODEX_HOME = join(HERO_ROOT, "codex")
const ENGINE_HOME = join(HERO_ROOT, "engine-home")
const SIDEBAR_WIDTH = 30

const PROMPT =
  "Add a 5 second request timeout to createClient in src/client.ts, and retry 5xx responses up to 3 times with backoff. Run the tests when you are done."

const DELEGATE = "Use rove to hand the README update for this change to another Codex agent. Wait for its report, then tell me what it said."

const CLAUDE_ARGS =
  '--model claude/claude-sonnet-5-5 --permission-mode auto --allowedTools "Bash(git *)" "Bash(bun test*)" --disallowedTools PowerShell --setting-sources project --disable-slash-commands'
const CODEX_ARGS = [
  "-c model_provider=cpa",
  `-c 'model_providers.cpa.name="cpa"'`,
  `-c 'model_providers.cpa.base_url="${process.env.HERO_OPENAI_BASE_URL ?? "http://127.0.0.1:8317/v1"}"'`,
  `-c 'model_providers.cpa.wire_api="responses"'`,
  `-c 'model_providers.cpa.env_key="CPA_API_KEY"'`,
  "-c model=gpt-5.6-terra -c model_reasoning_effort=medium -c disable_response_storage=true",
  // No sandbox: inside Codex's workspace-write sandbox `rove api` cannot reach the daemon's socket,
  // cannot list processes (which `send` does before it delivers), and cannot write the git index
  // of a worktree, so one Codex could not hand work to another. The fixture is a throwaway
  // directory and Codex runs with its own HOME.
  "--dangerously-bypass-approvals-and-sandbox -c check_for_update_on_startup=false",
].join(" ")

/** Codex goes through an OpenAI-compatible gateway (`HERO_OPENAI_API_KEY`), as Claude goes through the proxy. */
function codexCommand(): string {
  const key = process.env.HERO_OPENAI_API_KEY
  if (!key) throw new Error("set HERO_OPENAI_API_KEY: the key the Codex gateway accepts")
  // Its own HOME too: Codex also loads skills from ~/.agents, and would print the operator's path.
  return `env HOME=${ENGINE_HOME} CODEX_HOME=${CODEX_HOME} CPA_API_KEY=${key} ${engineBin("codex")} ${CODEX_ARGS}`
}

function engineBin(name: string): string {
  const bin = Bun.which(name)
  if (!bin) throw new Error(`${name} is not on PATH — the take needs it`)
  return bin
}

function claudeCommand(): string {
  const base = process.env.HERO_ANTHROPIC_BASE_URL ?? "http://127.0.0.1:8951"
  const token = process.env.HERO_ANTHROPIC_AUTH_TOKEN
  if (!token) throw new Error("set HERO_ANTHROPIC_AUTH_TOKEN: the token the proxy's upstream accepts")
  return `env CLAUDE_CONFIG_DIR=${CLAUDE_HOME} ANTHROPIC_BASE_URL=${base} ANTHROPIC_AUTH_TOKEN=${token} ENABLE_CLAUDEAI_MCP_SERVERS=false DISABLE_AUTOUPDATER=1 ${engineBin("claude")} ${CLAUDE_ARGS}`
}

/**
 * Rove's Claude hooks, as project settings: the tabs run `--setting-sources project`, which leaves
 * the operator's own settings (and the hooks Rove installed there) out of the take. They call this
 * checkout's CLI, so the take films the code under test, not the installed release.
 */
function projectHooks(): string {
  const hook = (verb: string) => ({ hooks: [{ type: "command", command: `node ${HERO_CLI} hook ${verb} --engine claude --hook-version 1` }] })
  const hooks = {
    Notification: ["permission_prompt", "elicitation_dialog"].map((matcher) => ({ matcher, ...hook("awaiting-input") })),
    SessionStart: [hook("session-start")],
    SessionEnd: [hook("session-end")],
    UserPromptSubmit: [hook("turn-start")],
    Stop: [hook("turn-complete")],
    StopFailure: [hook("turn-failed")],
    SubagentStart: [hook("subagent-start")],
    SubagentStop: [hook("subagent-stop")],
  }
  return `${JSON.stringify({ hooks }, null, 2)}\n`
}

async function setup(): Promise<void> {
  await stopHeroStack()
  await rm(HERO_ROOT, { recursive: true, force: true })
  await rm(TRIP, { force: true })
  await mkdir(HERO_HOME, { recursive: true })
  for (const [name, dir] of [["CLAUDE_CONFIG_DIR", CLAUDE_HOME], ["CODEX_HOME", CODEX_HOME]] as const) {
    if (process.env[name] !== dir) throw new Error(`export ${name}=${dir} for setup, hero-serve.ts and take`)
    await mkdir(dir, { recursive: true })
  }
  await mkdir(ENGINE_HOME, { recursive: true })
  // Past Claude Code's first-run theme and login screens; the token comes from the tab's environment.
  await writeFile(join(CLAUDE_HOME, ".claude.json"), `${JSON.stringify({ hasCompletedOnboarding: true, theme: "dark" })}\n`)
  // The skill that teaches an engine `rove api`, as `rove --skill` installs it.
  await cp(join(ROVE_DIR, "dist", "skills", "rove"), join(CODEX_HOME, "skills", "rove"), { recursive: true })
  await cp(join(ROVE_DIR, "dist", "skills", "rove"), join(CLAUDE_HOME, "skills", "rove"), { recursive: true })
  // Codex's folder-trust and new-model screens answered ahead of time, for both spellings of /tmp.
  const roots = [REPO, REPO.replace(/^\/tmp\//, "/private/tmp/")]
  await writeFile(
    join(CODEX_HOME, "config.toml"),
    `${roots.map((root) => `[projects."${root}"]\ntrust_level = "trusted"\n`).join("\n")}
[tui]
screen_reader_detection_done = true

[tui.model_availability_nux]
"gpt-6.1-sol" = 1

[notice.model_migrations]
"gpt-5.6-terra" = "gpt-6-sol"
`,
  )
  await writeFixtureWebToken(HERO_HOME)
  const { version } = JSON.parse(await readFile(join(ROVE_DIR, "package.json"), "utf8"))
  const skill = await readFile(join(ROVE_DIR, "dist", "skills", "rove", "SKILL.md"), "utf8").catch(() => "")
  const skillVersion = skill.match(/rove-skill-version:\s*(\d+)/)?.[1]
  const state: Record<string, unknown> = {
    "app.lastRunVersion": version,
    onboarded: true,
    skillHintSeen: "1",
    savedRepos: [REPO],
    defaultVendor: "claude",
    "engineCommand.claude": claudeCommand(),
    "engineCommand.codex": codexCommand(),
    "sidebar.width": SIDEBAR_WIDTH,
    ...(skillVersion ? { [`skillHintSeen:v${skillVersion}`]: "1" } : {}),
  }
  await mkdir(join(HERO_CONFIG, "rove"), { recursive: true })
  await writeFile(join(HERO_CONFIG, "rove", "state.json"), `${JSON.stringify(state, null, 2)}\n`)
  const files = [
    ...HERO_FILES,
    // Codex reads AGENTS.md, not CLAUDE.md.
    { path: ".claude/settings.json", body: projectHooks() },
    { path: "AGENTS.md", body: "# orbit-sdk\n\nA typed client for the Orbit API. `bun test` runs the suite. Work only inside this repository.\n" },
  ]
  const commits = [...HERO_COMMITS, { message: "docs: agent notes", paths: ["AGENTS.md", ".claude/settings.json"] }]
  await seedGitRepo(REPO, files, commits, env, { email: "dev@orbit.local", name: "Orbit" })
  console.log(`[handoff] fixture at ${HERO_ROOT}`)
}

type Task = { id: string; kind?: string; worktreePath?: string; activity?: { state?: string } | null }

function tasks(...args: string[]): Task[] {
  const result = runRoveApi(HERO_CLI, ["list", ...args], REPO, env)
  const list = result && typeof result === "object" && "tasks" in result ? result.tasks : undefined
  return Array.isArray(list) ? (list as Task[]) : []
}

const worker = (): Task | undefined => tasks().find((task) => task.kind !== "main")

/** Debug stills of an exploratory take: `HANDOFF_SNAP=<dir>`. */
async function snap(page: Page, name: string): Promise<void> {
  const dir = process.env.HANDOFF_SNAP
  if (dir) await page.screenshot({ path: join(dir, `${name}.png`) })
}

export const handoff: Film = {
  name: "handoff",
  setup,
  ready: "Welcome to Rove",
  viewport: { width: 1280, height: 720 },
  renderScale: 2,
  async take(page, cue, session) {
    await rm(TRIP, { force: true })
    await cue("tui-up")
    await page.waitForTimeout(2_000)
    const height = page.viewportSize()?.height ?? 720
    await page.getByTestId("opentui-terminal").click({ position: { x: 60, y: height - 140 } })
    await page.waitForTimeout(500)
    await press(page, "n")
    await cue("dialog")
    await page.waitForTimeout(600)
    await snap(page, "01-dialog")
    // Enter walks MODE → ENGINE → MODEL → EFFORT → REPO; REPO opens prefilled, so it is cleared.
    await press(page, "enter", "enter", "enter", "enter", "ctrl+u")
    await page.keyboard.type("orb", { delay: 90 })
    await page.waitForTimeout(500)
    await press(page, "tab")
    await page.waitForTimeout(700)
    for (let attempt = 0; attempt < 5 && !worker(); attempt += 1) {
      await press(page, "enter")
      await page.waitForTimeout(600)
    }
    await cue("created")
    for (let i = 0; i < 40 && !worker(); i += 1) await page.waitForTimeout(500)
    const task = worker()
    if (!task) throw new Error("no task appeared")
    runRoveApi(HERO_CLI, ["update", "--task-id", task.id, "--title", "Request timeout and retry", "--branch", "request-timeout"], REPO, env)
    if (await look(page, "trust this folder", 10_000)) {
      await page.waitForTimeout(400)
      await press(page, "down", "enter")
    }
    await look(page, "shift+tab to cycle", 45_000)
    await page.waitForTimeout(800)
    await cue("ready")
    await snap(page, "02-ready")
    await page.keyboard.insertText(PROMPT)
    await page.waitForTimeout(800)
    // From here the proxy lets a few more agent-loop requests through, then refuses: Claude is cut
    // off after it has read the code and started editing.
    await writeFile(TRIP, "armed\n")
    await press(page, "enter")
    await cue("prompted")

    // Claude Code may follow the stopped turn with a "Teach auto mode" prompt; Esc is its own "not now".
    await look(page, "hit your usage limit", 180_000)
    if (await look(page, "Teach auto mode", 4_000)) await press(page, "esc")
    const struck = await look(page, "Continue in another engine", 30_000)
    await cue("limit")
    await page.waitForTimeout(3_000)
    await snap(page, "04-limit")
    console.error(`[handoff] strip shown: ${struck}; trip exists: ${existsSync(TRIP)}`)
    if (process.env.HANDOFF_STOP === "limit") return
    if (await look(page, "Teach auto mode", 6_000)) {
      await press(page, "esc")
      await page.waitForTimeout(800)
    }
    await clickText(page, "Continue in another engine", SIDEBAR_WIDTH)
    await look(page, "New conversation", 10_000)
    await cue("picker")
    await page.waitForTimeout(1_200)
    // ENGINE opens on claude; codex is one to the right. DESTINATION and CONTEXT already say
    // "child task, same directory" and "continue this conversation".
    await press(page, "right")
    await page.waitForTimeout(900)
    await snap(page, "05-picker")
    await press(page, "enter")
    await cue("handoff")
    // Codex's own first-run prompts, in whatever order this version raises them.
    const prompts: readonly (readonly [string, readonly string[]])[] = [
      ["Trust this folder?", ["enter"]],
      // "2. Use existing model": the take pins its model.
      ["Try new model", ["down", "enter"]],
      // "2. Trust all and continue": the hooks are Rove's own, in a Codex home that exists only for
      // this take, and an untrusted set would stop the delegated Codex on the same prompt unattended.
      ["Hooks need review", ["down", "enter"]],
    ]
    for (let quiet = 0; quiet < 3; ) {
      const text = (await page.getByTestId("opentui-buffer").textContent()) ?? ""
      const hit = prompts.find(([needle]) => text.includes(needle))
      if (hit) {
        quiet = 0
        await page.waitForTimeout(500)
        await press(page, ...hit[1])
      } else quiet += 1
      await page.waitForTimeout(2_500)
    }
    await cue("codex-up")
    // Codex reads the old transcript, says where it stopped, and finishes the change.
    await look(page, "Worked for", 300_000)
    await page.waitForTimeout(2_500)
    await cue("codex-done")
    await snap(page, "06-codex-done")
    await page.keyboard.insertText(DELEGATE)
    await page.waitForTimeout(900)
    await press(page, "enter")
    await cue("delegate")
    // The delegated Codex shows up as a third row; both are then left working with nobody attached.
    for (let i = 0; i < 90 && tasks().filter((task) => task.kind !== "main").length < 3; i += 1) await page.waitForTimeout(2_000)
    await cue("dispatched")
    await page.waitForTimeout(7_000)
    await snap(page, "07-dispatched")
    await cue("close")
    await session.close()
    await page.waitForTimeout(3_000)
    await cue("closed")
    const deadline = Date.now() + 10 * 60_000
    let states: string[] = []
    while (Date.now() < deadline) {
      states = tasks("--activity", "idle,turn_complete,running,permission_needed,rate_limited,error,dead")
        .filter((task) => task.kind !== "main")
        .map((task) => task.activity?.state ?? "unknown")
      if (!states.some((state) => state === "running" || state === "unknown")) break
      await Bun.sleep(5_000)
    }
    console.error(`[handoff] reopening with turns ${states.join(", ")}`)
    await cue("reopen")
    await session.reopen()
    await look(page, "orbit-sdk", 60_000)
    await page.waitForTimeout(2_000)
    await cue("reopened")
    await snap(page, "08-reopened")
    await clickText(page, "INBOX", 0, { maxCol: SIDEBAR_WIDTH })
    await page.waitForTimeout(3_000)
    await cue("inbox")
    await snap(page, "09-inbox")
    await page.waitForTimeout(1_500)
    await press(page, "enter")
    await cue("opened")
    await page.waitForTimeout(5_000)
    await snap(page, "10-opened")
    await cue("end")
  },
  out: {
    clips: {
      cutFile: "packages/branding/films/handoff/cut.json",
      // Remotion serves its footage from public/.
      dir: "packages/branding/public/handoff",
      fps: 30,
    },
  },
}
