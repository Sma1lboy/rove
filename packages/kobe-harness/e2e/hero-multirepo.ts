/**
 * `node --experimental-strip-types e2e/hero-multirepo.ts --setup` then
 * `… e2e/hero-multirepo.ts [--out=dir]` — the raw take for the multi-repo
 * landing cut: three repos, a task started in each from the TUI, the terminal
 * closed and reopened with all three still running, then one task's diff.
 *
 * The take is RAW. It is long (real turns, folder-trust prompts) and the cut
 * is made afterwards from `beats.json`, which stamps every beat with its
 * offset into `take.webm`. `packages/branding` owns that edit.
 *
 * Run it under node, not bun: on Windows, bun's Playwright never gets a
 * Chromium launched. Point `HERO_ROOT` at a neutral directory for both this
 * script and `hero-serve.ts` — the fixture paths are on camera.
 */

import { mkdir, readdir, rm, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { chromium, type Page } from "@playwright/test"
import { runInFixture, runRoveApi, seedGitRepo, writeFixtureWebToken } from "../../kobe/scripts/fixture-core.ts"
import { REPO_ROOT, look, press, type as typeText } from "./hero-capture.ts"
import {
  HERO_CLI,
  HERO_CONFIG,
  HERO_HOME,
  HERO_PTY_PORT,
  HERO_REPO,
  HERO_ROOT,
  HERO_WEB_PORT,
  KOBE_DIR,
  fixtureAuthHeaders,
  heroEnv,
} from "./hero-env.ts"
import { HERO_COMMITS, HERO_FILES } from "./hero-repo.ts"
import { readFile } from "node:fs/promises"

const args = process.argv.slice(2)
const env = heroEnv()
const outDir = resolve(args.find((arg) => arg.startsWith("--out="))?.slice(6) ?? join(REPO_ROOT, ".scratch", "multirepo-take"))

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
const CLAUDE_COMMAND =
  'claude --effort high --permission-mode auto --allowedTools "Bash(git *)" "Bash(bun test*)" --disallowedTools PowerShell --setting-sources project --disable-slash-commands'

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
const CODEX_COMMAND = "codex -m gpt-6-astra -a on-request -s workspace-write -c check_for_update_on_startup=false"

async function setup(): Promise<void> {
  try {
    runInFixture("bun", [HERO_CLI, "daemon", "stop"], KOBE_DIR, env)
  } catch {
    // no daemon to stop
  }
  await rm(HERO_ROOT, { recursive: true, force: true })
  await mkdir(HERO_HOME, { recursive: true })
  await writeFixtureWebToken(HERO_HOME)
  const pkg = JSON.parse(await readFile(join(KOBE_DIR, "package.json"), "utf8")) as { version: string }
  const skill = await readFile(join(KOBE_DIR, "dist", "skills", "rove", "SKILL.md"), "utf8").catch(() => "")
  const skillVersion = skill.match(/(?:rove|kobe)-skill-version:\s*(\d+)/)?.[1]
  const state: Record<string, unknown> = {
    "app.lastRunVersion": pkg.version,
    onboarded: true,
    skillHintSeen: "1",
    savedRepos: [REPOS.orbit, REPOS.atlas, REPOS.ledger],
    defaultVendor: "claude",
    "engineCommand.claude": CLAUDE_COMMAND,
    "engineCommand.codex": CODEX_COMMAND,
    ...(skillVersion ? { [`skillHintSeen:v${skillVersion}`]: "1" } : {}),
  }
  await mkdir(join(HERO_CONFIG, "rove"), { recursive: true })
  await writeFile(join(HERO_CONFIG, "rove", "state.json"), `${JSON.stringify(state, null, 2)}\n`)
  await seedGitRepo(REPOS.orbit, HERO_FILES, HERO_COMMITS, env, { email: "dev@orbit.local", name: "Orbit" })
  await seedGitRepo(REPOS.atlas, ATLAS.files, ATLAS.commits, env, { email: "dev@atlas.local", name: "Atlas" })
  await seedGitRepo(REPOS.ledger, LEDGER.files, LEDGER.commits, env, { email: "dev@ledger.local", name: "Ledger" })
  console.log(`[multirepo] fixture at ${HERO_ROOT}`)
}

// ── the take ────────────────────────────────────────────────────────────

const beats: { name: string; t: number }[] = []
let t0 = 0
function mark(name: string): void {
  const t = (Date.now() - t0) / 1000
  beats.push({ name, t })
  console.log(`[multirepo] ${t.toFixed(1)}s ${name}`)
}

/**
 * Row (0-based) of the first buffer line whose columns around `x` contain
 * `needle`, or -1. The buffer is one `<pre>` of screen lines spanning every
 * pane, so a match is scoped to the pane the click will land in.
 */
async function rowOf(page: Page, needle: string, x = 80): Promise<number> {
  const col = Math.floor(x / CELL_W)
  return page.getByTestId("opentui-buffer").evaluate(
    (el, [text, c]) => {
      const lines = (el.textContent ?? "").split("\n")
      const lo = Math.max(0, (c as number) - 30)
      for (let i = 0; i < lines.length; i += 1) if (lines[i]!.slice(lo, (c as number) + 30).includes(text as string)) return i
      return -1
    },
    [needle, col] as const,
  )
}

const CELL_H = 16
const CELL_W = 7
/**
 * 16:9, so the window fills a 16:9 film without looking tall and narrow.
 * 810 rows of pixels keep the 16px cell grid the stills were framed on.
 */
const VIEWPORT = { width: 1440, height: 810 } as const
/** Columns right of this belong to the Changes/files pane. */
const RIGHT_PANE_COL = 160

/** Click the first occurrence of `needle` at or right of column `minCol`. */
async function clickText(page: Page, needle: string, minCol: number): Promise<boolean> {
  const hit = await page.getByTestId("opentui-buffer").evaluate(
    (el, [text, min]) => {
      const lines = (el.textContent ?? "").split("\n")
      for (let i = 0; i < lines.length; i += 1) {
        const at = lines[i]!.indexOf(text as string, min as number)
        if (at >= 0) return { row: i, col: at, width: lines[i]!.length }
      }
      return null
    },
    [needle, minCol] as const,
  )
  if (!hit) {
    console.error(`[multirepo] no text ${JSON.stringify(needle)} right of column ${minCol}`)
    return false
  }
  const cellW = VIEWPORT.width / hit.width
  await page.getByTestId("opentui-terminal").click({ position: { x: (hit.col + 2) * cellW, y: hit.row * CELL_H + CELL_H / 2 } })
  await page.waitForTimeout(700)
  return true
}
async function clickRow(page: Page, needle: string, x = 80): Promise<boolean> {
  const row = await rowOf(page, needle, x)
  if (row < 0) {
    console.error(`[multirepo] no row for ${JSON.stringify(needle)}`)
    return false
  }
  await page.getByTestId("opentui-terminal").click({ position: { x, y: row * CELL_H + CELL_H / 2 } })
  await page.waitForTimeout(700)
  return true
}

function tasks(): { id: string; title: string; repo: string; worktreePath?: string }[] {
  return ((runRoveApi(HERO_CLI, ["list"], REPOS.orbit, env) as { tasks?: never[] }).tasks ?? []) as never
}

/**
 * The ENGINE row, in dialog order. It WRAPS and opens on the last engine
 * used, so the storyboard tracks where it left the selection and moves by
 * the difference — absolute moves ("left until claude") land wherever the
 * wrap puts them.
 */
const ENGINES = ["claude", "codex", "kimi", "gemini"] as const
let engineAt = 0

/** What each engine draws once its composer takes input. */
const READY: Record<string, string> = { claude: "shift+tab to cycle", codex: "Ask Codex to do anything" }

/** `n`, choose engine and repo, create, get past first-run prompts, hand the engine its prompt. */
async function startTask(page: Page, repo: string, engine: (typeof ENGINES)[number], prompt: string, index: number): Promise<void> {
  const before = tasks().length
  // Focus the sidebar with a click on its empty lower half, then the real
  // keystroke — the film says "press n", so the take presses n.
  await page.getByTestId("opentui-terminal").click({ position: { x: 60, y: VIEWPORT.height - 140 } })
  await page.waitForTimeout(500)
  await press(page, "n")
  mark(`dialog-${index}`)
  await page.waitForTimeout(600)
  // Enter walks MODE → ENGINE → REPO; REPO opens prefilled with the last
  // repo, so it is cleared before typing.
  await press(page, "enter")
  const target = ENGINES.indexOf(engine)
  for (; engineAt < target; engineAt += 1) await press(page, "right")
  for (; engineAt > target; engineAt -= 1) await press(page, "left")
  await page.waitForTimeout(300)
  await press(page, "enter", "ctrl+u")
  await page.keyboard.type(repo.slice(0, 3), { delay: 90 })
  await page.waitForTimeout(500)
  await press(page, "tab")
  mark(`repo-${index}`)
  await page.waitForTimeout(700)
  // Enter → FROM BRANCH, Enter → create. The repo check can fail on a slow
  // git spawn; the dialog stays open with a reason, and Enter re-submits.
  await press(page, "enter", "enter")
  for (let attempt = 0; attempt < 3 && (await look(page, "isn't a git repository", 1_500)); attempt += 1) {
    await press(page, "enter")
  }
  mark(`created-${index}`)
  for (let i = 0; i < 40 && tasks().length === before; i += 1) await page.waitForTimeout(500)
  if (await look(page, "trust this folder", 10_000)) {
    mark(`trust-${index}`)
    await page.waitForTimeout(400)
    await press(page, "down", "enter")
  }
  if (engine === "codex" && (await look(page, "Hooks need review", 15_000))) {
    mark(`hooks-${index}`)
    await page.waitForTimeout(400)
    // 3. Continue without trusting (hooks won't run).
    await press(page, "down", "down", "enter")
  }
  // The composer is ready once the engine draws its own footer.
  await look(page, READY[engine]!, 45_000)
  await page.waitForTimeout(800)
  mark(`ready-${index}`)
  // Pasted, not typed: at a readable typing speed three prompts cost a minute
  // and a half of take, and the agents finish before the reopen beat.
  await page.keyboard.insertText(prompt)
  // Verified with whitespace stripped: Codex wraps the composer, so the tail
  // of a long prompt straddles a screen line and a plain substring check
  // misses it, and the fallback below would type the prompt a second time.
  const squash = (text: string) => text.replace(/\s+/g, "")
  const tail = squash(prompt).slice(-24)
  let landed = false
  for (let i = 0; i < 10 && !landed; i += 1) {
    await page.waitForTimeout(500)
    landed = squash((await page.getByTestId("opentui-buffer").textContent()) ?? "").includes(tail)
  }
  if (!landed) await typeText(page, prompt)
  await press(page, "enter")
  mark(`prompted-${index}`)
}

async function take(): Promise<void> {
  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir: outDir, size: VIEWPORT },
  })
  const runs: string[] = []
  const closeRun = async (run: string) =>
    fetch(`http://127.0.0.1:${HERO_PTY_PORT}/pty/close`, {
      method: "POST",
      headers: { "content-type": "application/json", ...fixtureAuthHeaders() },
      body: JSON.stringify({ tab: `visual-${run}` }),
    }).catch(() => {})
  const open = async (page: Page, marker: string) => {
    const run = `multi-${Date.now()}`
    runs.push(run)
    await page.goto(`http://localhost:${HERO_WEB_PORT}/harness?run=${run}`)
    await page.getByTestId("opentui-harness").waitFor({ timeout: 15_000 })
    await look(page, marker, 60_000)
    await page.waitForTimeout(1_000)
    return run
  }
  try {
    const page = await context.newPage()
    t0 = Date.now()
    const first = await open(page, "Welcome to Rove")
    mark("tui-up")
    await page.waitForTimeout(2_000)

    for (const [index, spec] of TAKES.entries()) {
      await startTask(page, spec.repo, spec.engine, spec.prompt, index)
      await page.waitForTimeout(3_000)
    }
    mark("all-running")
    // Hold on the sidebar with three live rows.
    await page.waitForTimeout(5_000)

    // Close the terminal: the TUI process goes away, the daemon keeps the engines.
    mark("close")
    await closeRun(first)
    await page.waitForTimeout(3_000)
    mark("closed")
    await page.goto("about:blank")
    await page.waitForTimeout(4_000)
    mark("reopen")
    await open(page, "ledger-api")
    mark("reopened")
    await page.waitForTimeout(8_000)

    // Open the first task and diff it. Its row label is the branch slug, which
    // is only known now; each repo also has a `master` row to not land on.
    const orbitTask = tasks().find((task) => task.repo.endsWith("orbit-sdk") && (task as { kind?: string }).kind !== "main")
    const slug = (orbitTask as { branch?: string } | undefined)?.branch?.split("/").pop()?.slice(0, 12) ?? "add-a-"
    await clickRow(page, slug, 60)
    mark("task-open")
    await page.waitForTimeout(3_000)
    await clickText(page, "Changes", RIGHT_PANE_COL)
    mark("changes")
    await page.waitForTimeout(2_000)
    await clickText(page, "diff everything", RIGHT_PANE_COL)
    mark("diff")
    await page.waitForTimeout(9_000)
    mark("end")
    await closeRun(runs.at(-1)!)
  } finally {
    await context.close()
    await browser.close()
  }
  const video = (await readdir(outDir)).find((file) => file.endsWith(".webm"))
  if (video && video !== "take.webm") await (await import("node:fs/promises")).rename(join(outDir, video), join(outDir, "take.webm"))
  await writeFile(join(outDir, "beats.json"), `${JSON.stringify({ beats, tasks: tasks() }, null, 2)}\n`)
  console.log(join(outDir, "take.webm"))
}

if (args.includes("--setup")) await setup()
else await take()
