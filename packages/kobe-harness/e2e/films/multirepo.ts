/**
 * The landing film: three repos, a task started in each from the TUI (Claude
 * Code, Codex, Claude Code), the terminal closed and reopened with all three
 * still running, then one task's diff.
 *
 *   HERO_ROOT=/tmp/rove-hero-multi bun e2e/film.ts setup multirepo   # its own 3-repo fixture
 *   HERO_ROOT=/tmp/rove-hero-multi bun e2e/hero-serve.ts             # keep running
 *   HERO_ROOT=/tmp/rove-hero-multi bun e2e/film.ts take multirepo    # REAL turns: quota
 *   bun e2e/film.ts render multirepo                                 # clips for the composition
 *
 * The take is raw and long (real turns, first-run prompts). The edit lives in
 * `packages/branding/films/multirepo` (HyperFrames): its `cut.json` names the
 * stretches of this take it shows, by cue, and `render` writes them as clips.
 * Fixture paths are on camera, so `HERO_ROOT` must be neutral.
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { Page } from "@playwright/test"
import { runRoveApi, seedGitRepo, writeFixtureWebToken } from "../../../kobe/scripts/fixture-core.ts"
import type { Cue, Film } from "../film/film.ts"
import { clickText, look, press, type as typeText } from "../hero-capture.ts"
import { HERO_CLI, HERO_CONFIG, HERO_HOME, HERO_REPO, HERO_ROOT, heroEnv, KOBE_DIR, stopHeroStack } from "../hero-env.ts"
import { HERO_COMMITS, HERO_FILES } from "../hero-repo.ts"

const env = heroEnv()

type File = { path: string; body: string }
type Commit = { message: string; paths: string[] }

const ATLAS: { files: File[]; commits: Commit[] } = {
  files: [
    {
      path: "package.json",
      body: `{\n  "name": "atlas-web",\n  "private": true,\n  "type": "module",\n  "scripts": { "test": "bun test" }\n}\n`,
    },
    { path: "CLAUDE.md", body: "# atlas-web\n\nThe Atlas dashboard. `bun test` runs the suite. Commit with a short `type: summary` subject.\n" },
    // Codex works this repo on camera, and it reads AGENTS.md, not CLAUDE.md.
    { path: "AGENTS.md", body: "# atlas-web\n\nThe Atlas dashboard. `bun test` runs the suite. Work only inside this repository.\n" },
    {
      path: "src/format.ts",
      body: `export function formatBytes(n: number): string {\n  if (n < 1024) return \`\${n} B\`\n  return \`\${(n / 1024).toFixed(1)} KB\`\n}\n\nexport function formatDate(d: Date): string {\n  return d.toISOString().slice(0, 10)\n}\n`,
    },
    {
      path: "src/table.ts",
      body: `import { formatBytes, formatDate } from "./format.ts"\n\nexport type Row = { name: string; size: number; modified: Date }\n\nexport function renderRow(row: Row): string {\n  return [row.name, formatBytes(row.size), formatDate(row.modified)].join("  ")\n}\n`,
    },
  ],
  commits: [
    { message: "feat: file table", paths: ["package.json", "CLAUDE.md", "AGENTS.md", "src/format.ts", "src/table.ts"] },
  ],
}

const LEDGER: { files: File[]; commits: Commit[] } = {
  files: [
    {
      path: "package.json",
      body: `{\n  "name": "ledger-api",\n  "private": true,\n  "type": "module",\n  "scripts": { "test": "bun test" }\n}\n`,
    },
    { path: "CLAUDE.md", body: "# ledger-api\n\nTransfers between accounts. `bun test` runs the suite. Commit with a short `type: summary` subject.\n" },
    {
      path: "src/transfer.ts",
      body: `export type Account = { id: string; balance: number }\n\nexport function transfer(from: Account, to: Account, amount: number): void {\n  from.balance -= amount\n  to.balance += amount\n}\n`,
    },
    {
      path: "test/transfer.test.ts",
      body: `import { expect, test } from "bun:test"\nimport { transfer } from "../src/transfer.ts"\n\ntest("moves money", () => {\n  const a = { id: "a", balance: 10 }\n  const b = { id: "b", balance: 0 }\n  transfer(a, b, 4)\n  expect([a.balance, b.balance]).toEqual([6, 4])\n})\n`,
    },
  ],
  commits: [{ message: "feat: transfers", paths: ["package.json", "CLAUDE.md", "src/transfer.ts", "test/transfer.test.ts"] }],
}

const REPOS = { orbit: HERO_REPO, atlas: join(HERO_ROOT, "atlas-web"), ledger: join(HERO_ROOT, "ledger-api") } as const

/**
 * One task per repo, in the order they are started on camera. None of them
 * commits: the Changes pane diffs the WORKING TREE, and a committed turn
 * would leave the closing diff beat with nothing to show.
 */
const TAKES = [
  {
    repo: "orbit-sdk",
    engine: "claude",
    prompt:
      "Add a configurable request timeout (default 5s) to createClient in src/client.ts that aborts the fetch, cover it in test/client.test.ts, run bun test until green, and describe it in README.md. Don't commit.",
  },
  {
    repo: "atlas-web",
    engine: "codex",
    prompt:
      "Make formatBytes handle KB, MB, GB and TB, add a formatDuration helper, test both in test/format.test.ts, run bun test until green, and describe it in README.md. Don't commit.",
  },
  {
    repo: "ledger-api",
    engine: "claude",
    prompt:
      "Make transfer() reject non-positive amounts and overdrafts, record each transfer in a history log, cover it all in the tests, run bun test until green, and describe it in README.md. Don't commit.",
  },
] as const

/**
 * Unlike `hero-fixture.ts`, `auto` rather than `acceptEdits` + an allowlist:
 * these prompts are open-ended, and an allowlist cannot anticipate every
 * command an agent reaches for (a file listing, a test written through a
 * heredoc) — each miss is an approval nobody is there to answer. `auto` lets
 * Claude Code's own classifier clear routine actions in the throwaway repo
 * and still stops risky ones; it is not `bypassPermissions`. PowerShell stays
 * off so every command is Bash.
 */
const CLAUDE_ARGS =
  '--effort high --permission-mode auto --allowedTools "Bash(git *)" "Bash(bun test*)" --disallowedTools PowerShell --setting-sources project --disable-slash-commands'

/**
 * The engine binary the operator's own shell runs, as an absolute path. The
 * daemon's PATH can order installs differently (Homebrew ahead of nvm), and an
 * older engine than the operator's films an error instead of a turn.
 */
function engineBin(name: string): string {
  const bin = Bun.which(name)
  if (!bin) throw new Error(`${name} is not on PATH — the take needs it`)
  return bin
}

/**
 * `HERO_ANTHROPIC_BASE_URL` + `HERO_ANTHROPIC_AUTH_TOKEN` at setup route the
 * Claude tasks through an Anthropic-compatible proxy (an account pool), for
 * when the operator's own login is out of quota. The values land only in the
 * fixture's state.json; `env` is exec'd, so the tab's process is still claude.
 * The claude.ai connectors are off so the banner does not warn that a proxy
 * token replaced the login.
 */
function claudeCommand(): string {
  const command = `${engineBin("claude")} ${CLAUDE_ARGS}`
  const base = process.env.HERO_ANTHROPIC_BASE_URL
  const token = process.env.HERO_ANTHROPIC_AUTH_TOKEN
  if (!base || !token) return command
  return `env ANTHROPIC_BASE_URL=${base} ANTHROPIC_AUTH_TOKEN=${token} ENABLE_CLAUDEAI_MCP_SERVERS=false ${command}`
}

/**
 * The middle task runs Codex, so the take shows more than one engine.
 * `-a on-request -s workspace-write` (Codex's full-auto): commands run freely
 * inside the workspace-write sandbox and it still asks before stepping
 * outside it. If Codex stops on "Hooks need review" (the operator's
 * `~/.codex/hooks.json` changed since they last trusted it), the storyboard
 * picks "Continue without trusting" — trusting is the operator's call, not a
 * capture's. The model is pinned because the operator's configured default
 * need not be one their account can run from this Codex version, which fails
 * the turn with a 400. The update check is off so Codex's own "update
 * available" box stays out of the take.
 */
const CODEX_ARGS = "-m gpt-6-astra -a on-request -s workspace-write -c check_for_update_on_startup=false"

async function setup(): Promise<void> {
  await stopHeroStack()
  await rm(HERO_ROOT, { recursive: true, force: true })
  await mkdir(HERO_HOME, { recursive: true })
  await writeFixtureWebToken(HERO_HOME)
  const { version } = JSON.parse(await readFile(join(KOBE_DIR, "package.json"), "utf8"))
  const skill = await readFile(join(KOBE_DIR, "dist", "skills", "rove", "SKILL.md"), "utf8").catch(() => "")
  const skillVersion = skill.match(/(?:rove|kobe)-skill-version:\s*(\d+)/)?.[1]
  const state: Record<string, unknown> = {
    "app.lastRunVersion": version,
    onboarded: true,
    skillHintSeen: "1",
    savedRepos: [REPOS.orbit, REPOS.atlas, REPOS.ledger],
    defaultVendor: "claude",
    "engineCommand.claude": claudeCommand(),
    "engineCommand.codex": `${engineBin("codex")} ${CODEX_ARGS}`,
    ...(skillVersion ? { [`skillHintSeen:v${skillVersion}`]: "1" } : {}),
  }
  await mkdir(join(HERO_CONFIG, "rove"), { recursive: true })
  await writeFile(join(HERO_CONFIG, "rove", "state.json"), `${JSON.stringify(state, null, 2)}\n`)
  await seedGitRepo(REPOS.orbit, HERO_FILES, HERO_COMMITS, env, { email: "dev@orbit.local", name: "Orbit" })
  await seedGitRepo(REPOS.atlas, ATLAS.files, ATLAS.commits, env, { email: "dev@atlas.local", name: "Atlas" })
  await seedGitRepo(REPOS.ledger, LEDGER.files, LEDGER.commits, env, { email: "dev@ledger.local", name: "Ledger" })
  console.log(`[multirepo] fixture at ${HERO_ROOT}`)
}

type Task = { repo: string; kind?: string; branch?: string }

function tasks(): Task[] {
  const result = runRoveApi(HERO_CLI, ["list"], REPOS.orbit, env)
  const list = result && typeof result === "object" && "tasks" in result ? result.tasks : undefined
  return Array.isArray(list) ? list.filter((t): t is Task => typeof t?.repo === "string") : []
}

/**
 * The ENGINE row, in dialog order. It WRAPS and opens on the last engine
 * used, so the storyboard tracks where it left the selection and moves by
 * the difference — absolute moves ("left until claude") land wherever the
 * wrap puts them.
 */
const ENGINES = ["claude", "codex"] as const
let engineAt = 0

/** What each engine draws once its composer takes input. */
const READY: Record<(typeof ENGINES)[number], string> = { claude: "shift+tab to cycle", codex: "Ask Codex to do anything" }

/** Each engine's first-run folder-trust prompt, and the keys that accept it. */
const TRUST: Record<(typeof ENGINES)[number], { prompt: string; keys: string[] }> = {
  claude: { prompt: "trust this folder", keys: ["down", "enter"] },
  // "1. Yes, continue" is preselected.
  codex: { prompt: "Do you trust the contents of this directory", keys: ["enter"] },
}

/** `n`, choose engine and repo, create, get past first-run prompts, hand the engine its prompt. */
async function startTask(page: Page, cue: Cue, spec: (typeof TAKES)[number], index: number): Promise<void> {
  const before = tasks().length
  // Focus the sidebar with a click on its empty lower half, then the real
  // keystroke — the film says "press n", so the take presses n.
  const height = page.viewportSize()?.height ?? 810
  await page.getByTestId("opentui-terminal").click({ position: { x: 60, y: height - 140 } })
  await page.waitForTimeout(500)
  await press(page, "n")
  await cue(`dialog-${index}`)
  await page.waitForTimeout(600)
  // Enter walks MODE → ENGINE → REPO; REPO opens prefilled with the last
  // repo, so it is cleared before typing.
  await press(page, "enter")
  const target = ENGINES.indexOf(spec.engine)
  for (; engineAt < target; engineAt += 1) await press(page, "right")
  for (; engineAt > target; engineAt -= 1) await press(page, "left")
  await page.waitForTimeout(300)
  await press(page, "enter", "ctrl+u")
  await page.keyboard.type(spec.repo.slice(0, 3), { delay: 90 })
  await page.waitForTimeout(500)
  await press(page, "tab")
  await cue(`repo-${index}`)
  await page.waitForTimeout(700)
  // Enter → FROM BRANCH, Enter → create. The repo check can fail on a slow
  // git spawn; the dialog stays open with a reason, and Enter re-submits.
  await press(page, "enter", "enter")
  for (let attempt = 0; attempt < 3 && (await look(page, "isn't a git repository", 1_500)); attempt += 1) {
    await press(page, "enter")
  }
  await cue(`created-${index}`)
  for (let i = 0; i < 40 && tasks().length === before; i += 1) await page.waitForTimeout(500)
  // Each engine asks, in its own words, before working in a directory it has
  // never seen — the throwaway fixture repo is what gets trusted.
  const trust = TRUST[spec.engine]
  if (await look(page, trust.prompt, 10_000)) {
    await cue(`trust-${index}`)
    await page.waitForTimeout(400)
    await press(page, ...trust.keys)
  }
  if (spec.engine === "codex" && (await look(page, "Hooks need review", 15_000))) {
    await cue(`hooks-${index}`)
    await page.waitForTimeout(400)
    // 3. Continue without trusting (hooks won't run).
    await press(page, "down", "down", "enter")
  }
  // The composer is ready once the engine draws its own footer.
  await look(page, READY[spec.engine], 45_000)
  await page.waitForTimeout(800)
  await cue(`ready-${index}`)
  // Pasted, not typed: at a readable typing speed three prompts cost a minute
  // and a half of take, and the agents finish before the reopen beat.
  await page.keyboard.insertText(spec.prompt)
  // Verified with whitespace stripped: Codex wraps the composer, so the tail
  // of a long prompt straddles a screen line and a plain substring check
  // misses it, and the fallback below would type the prompt a second time.
  const squash = (text: string) => text.replace(/\s+/g, "")
  const tail = squash(spec.prompt).slice(-24)
  let landed = false
  for (let i = 0; i < 10 && !landed; i += 1) {
    await page.waitForTimeout(500)
    landed = squash((await page.getByTestId("opentui-buffer").textContent()) ?? "").includes(tail)
  }
  if (!landed) await typeText(page, spec.prompt)
  await press(page, "enter")
  await cue(`prompted-${index}`)
}

/** Columns right of this belong to the Changes/files pane at 1440 wide. */
const RIGHT_PANE_COL = 160

export const multirepo: Film = {
  name: "multirepo",
  setup,
  ready: "Welcome to Rove",
  // 16:9, so the window fills a 16:9 film without looking tall and narrow;
  // 810 rows of pixels keep the 16px cell grid.
  viewport: { width: 1440, height: 810 },
  async take(page, cue, session) {
    engineAt = 0
    await cue("tui-up")
    await page.waitForTimeout(2_000)
    for (const [index, spec] of TAKES.entries()) {
      await startTask(page, cue, spec, index)
      await page.waitForTimeout(3_000)
    }
    await cue("all-running")
    // Hold on the sidebar with three live rows.
    await page.waitForTimeout(5_000)

    // Close the terminal: the TUI process goes away, the daemon keeps the engines.
    await cue("close")
    await session.close()
    await page.waitForTimeout(3_000)
    await cue("closed")
    await page.waitForTimeout(4_000)
    await cue("reopen")
    await session.reopen()
    await look(page, "ledger-api", 60_000)
    await page.waitForTimeout(1_000)
    await cue("reopened")
    await page.waitForTimeout(8_000)

    // Open the first task and diff it. Its row label is the branch slug, which
    // is only known now; each repo also has a main row to not land on.
    const orbitTask = tasks().find((task) => task.repo.endsWith("orbit-sdk") && task.kind !== "main")
    const slug = orbitTask?.branch?.split("/").pop()?.slice(0, 12) ?? "add-a-"
    await clickText(page, slug)
    await cue("task-open")
    await page.waitForTimeout(3_000)
    await clickText(page, "Changes", RIGHT_PANE_COL)
    await cue("changes")
    await page.waitForTimeout(2_000)
    await clickText(page, "diff everything", RIGHT_PANE_COL)
    await cue("diff")
    await page.waitForTimeout(9_000)
    await cue("end")
  },
  out: {
    clips: {
      cutFile: "packages/branding/films/multirepo/cut.json",
      dir: "packages/branding/films/multirepo/clips",
      fps: 30,
    },
  },
}
