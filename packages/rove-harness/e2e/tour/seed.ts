/**
 * The tour's throwaway homes: `empty` (a first run) and `full` (two projects, five shell tasks, diffs, inbox rows,
 * routines, kanban cards and a Compare round). Every task runs a plain bash, never an engine.
 */

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, realpathSync } from "node:fs"
import { chmod, mkdir, writeFile } from "node:fs/promises"
import { isAbsolute, join, relative } from "node:path"
import { buildFixtureEnv, writeFixtureWebToken } from "../../../rove/scripts/fixture-core.ts"

export type HomeName = "empty" | "full"
export interface Home {
  readonly name: HomeName
  readonly root: string
  readonly home: string
  readonly env: Record<string, string>
  /** The checkout whose `packages/rove` runs here. */
  readonly roveDir: string
}

const SHELL = "bash --norc --noprofile -i"
// A pinned date keeps commit hashes, and so every shot that prints one, the same run to run.
const GIT_ID = {
  GIT_AUTHOR_NAME: "dev",
  GIT_AUTHOR_EMAIL: "dev@example.com",
  GIT_COMMITTER_NAME: "dev",
  GIT_COMMITTER_EMAIL: "dev@example.com",
  GIT_AUTHOR_DATE: "2026-07-15T12:00:00Z",
  GIT_COMMITTER_DATE: "2026-07-15T12:00:00Z",
}

export function homeEnv(root: string, extra: Record<string, string> = {}): Record<string, string> {
  const home = join(root, "home")
  return buildFixtureEnv({ root, home, ports: {}, homePolicy: "redirect", extra: { ...GIT_ID, LANG: "en_US.UTF-8", SHELL: "/bin/bash", ...extra } })
}

export function rove(h: Pick<Home, "env" | "roveDir">, args: readonly string[], cwd = h.roveDir): string {
  return execFileSync("bun", ["--conditions=browser", join(h.roveDir, "src/cli/rove.ts"), ...args], {
    cwd,
    env: h.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim()
}
const api = (h: Home, args: readonly string[]) => JSON.parse(rove(h, ["api", ...args]))

async function writeState(h: Home, state: Record<string, unknown>): Promise<void> {
  const dir = join(h.home, ".config", "rove")
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, "state.json"), `${JSON.stringify(state, null, 2)}\n`)
}

/** Runs a seeding script, only ever inside the home's own root: a script that ran in the caller's checkout would commit there. */
function sh(root: string, cwd: string, script: string, env: Record<string, string>): void {
  const inside = relative(realpathSync(root), realpathSync(cwd))
  if (!cwd || inside.startsWith("..") || isAbsolute(inside)) throw new Error(`refusing to seed outside ${root}: ${cwd}`)
  execFileSync("bash", ["-c", script], { cwd, env, stdio: ["ignore", "ignore", "inherit"] })
}

async function seedRepo(root: string, dir: string, env: Record<string, string>): Promise<void> {
  await mkdir(join(dir, "src"), { recursive: true })
  const name = dir.split("/").pop()
  sh(
    root,
    dir,
    `git init -q -b main
printf '# ${name}\\n\\nDemo project.\\n' > README.md
printf 'export function add(a: number, b: number) {\\n  return a + b\\n}\\n' > src/math.ts
printf '{\\n  "name": "${name}",\\n  "version": "1.0.0"\\n}\\n' > package.json
git add -A && git commit -qm "initial commit"
printf 'export const VERSION = "1.0.0"\\n' > src/version.ts && git add -A && git commit -qm "add version"`,
    env,
  )
}

export async function seedHome(name: HomeName, root: string, roveDir: string, version: string): Promise<Home> {
  const h: Home = { name, root, home: join(root, "home"), env: homeEnv(root), roveDir }
  try {
    await seed(h, version)
  } catch (err) {
    stopHome(h)
    throw err
  }
  return h
}

/** `add --start` answers before the task has a worktree: its path shows up in the list once it is on disk. */
async function worktree(h: Home, taskId: string): Promise<string> {
  for (let i = 0; ; i++) {
    const tasks = (api(h, ["list"]) as { tasks: { id: string; worktreePath?: string }[] }).tasks
    const path = tasks.find((t) => t.id === taskId)?.worktreePath
    if (path && existsSync(join(path, ".git"))) return path
    if (i > 100) throw new Error(`task ${taskId} never got a worktree`)
    await new Promise((r) => setTimeout(r, 100))
  }
}

async function seed(h: Home, version: string): Promise<void> {
  const { name, root, env } = h
  await mkdir(join(h.home, ".runtime"), { recursive: true })
  await chmod(join(h.home, ".runtime"), 0o700)
  await writeFixtureWebToken(h.home)
  if (name === "empty") {
    // A first run: the welcome checklist and every empty state.
    await writeState(h, {})
    return
  }
  // Someone who has used Rove: no welcome, no once-per-home notices over the shots.
  await writeState(h, { "app.lastRunVersion": version, welcomed: true, skillHintSeen: "1", "hints.statusMark.seen": true })
  const api$ = join(root, "acme-api")
  const web$ = join(root, "acme-web")
  await seedRepo(root, api$, env)
  await seedRepo(root, web$, env)
  const add = (repo: string, title: string, more: string[] = []) =>
    api(h, ["add", "--repo", repo, "--no-parent", "--title", title, "--command", SHELL, "--start", ...more]) as { taskId: string }
  const login = add(api$, "Fix login redirect loop")
  const limit = add(api$, "Add rate limiting to /auth")
  const dark = add(web$, "Dark mode for settings page")
  const react = add(web$, "Upgrade React to 19")
  api(h, ["add", "--repo", api$, "--parent", limit.taskId, "--title", "Write tests for limiter", "--command", SHELL, "--start"])

  sh(
    root,
    await worktree(h, limit.taskId),
    `printf 'const WINDOW_MS = 60_000\\nconst LIMIT = 20\\nexport function allow(k: string) { return true }\\n' > src/limiter.ts
printf 'export function add(a: number, b: number): number {\\n  if (Number.isNaN(a)) return 0\\n  return a + b\\n}\\n' > src/math.ts
git add -A && git commit -qm "limiter: sliding window"
printf '\\n## Rate limits\\n\\n20 requests per minute per IP.\\n' >> README.md`,
    env,
  )
  sh(
    root,
    await worktree(h, login.taskId),
    `printf 'export function redirectTo(p: string) {\\n  return p.startsWith("/") ? p : "/"\\n}\\n' > src/redirect.ts
sed -i '' 's/Demo project./Demo project, now with safe redirects./' README.md`,
    env,
  )
  sh(root, await worktree(h, dark.taskId), `printf ':root { color-scheme: dark; }\\n' > src/theme.css`, env)

  api(h, ["engine-report", "--task-id", limit.taskId, "--tab", "tab-1", "--kind", "awaiting-input"])
  api(h, ["engine-report", "--task-id", dark.taskId, "--tab", "tab-1", "--kind", "turn-complete"])
  api(h, ["engine-report", "--task-id", react.taskId, "--tab", "tab-1", "--kind", "turn-failed"])

  const routine = (repo: string, args: string[]) => api(h, ["routine-create", "--repo", repo, ...args])
  routine(api$, ["--name", "Nightly dependency audit", "--schedule", "0 3 * * *", "--script", 'echo "0 vulnerabilities found in 42 packages"'])
  routine(web$, ["--name", "Lint on weekdays", "--schedule", "30 9 * * MON-FRI", "--script", 'echo "src/app.tsx:12 unused import"; exit 1'])
  routine(api$, ["--name", "Weekly changelog draft", "--schedule", "0 10 * * FRI", "--prompt", "Draft this week's changelog.", "--vendor", "claude", "--disabled"])
  const routines = api(h, ["routine-list"]) as { automations: { id: string; enabled: boolean }[] }
  for (const r of routines.automations.filter((a) => a.enabled)) api(h, ["routine-run-now", "--id", r.id])

  rove(h, ["plugin", "install", "kanban"])
  rove(h, ["plugin", "install", "issues"])
  const issue = (title: string) =>
    (api(h, ["issue-create", "--repo", api$, "--title", title, "--body", `Details for: ${title}`]) as { issues: { id: number }[] }).issues.at(-1)!.id
  issue("Retry failed webhooks")
  issue("Rotate JWT signing keys")
  api(h, ["issue-update", "--repo", api$, "--id", String(issue("Rate limiting on /auth")), "--task", limit.taskId])
  api(h, ["issue-update", "--repo", api$, "--id", String(issue("Remove legacy v1 endpoints")), "--status", "done"])

  // A Compare round. `--count` needs `--prompt`, which a bash "engine" cannot take: the start reports a failure,
  // and the round's two tasks stay, each with an exited shell.
  try {
    api(h, ["add", "--repo", web$, "--no-parent", "--count", "2", "--command", SHELL, "--prompt", "echo layout", "--title", "Try two navbar layouts"])
  } catch {
    // Expected: see above.
  }
}

/** Both Compare attempts' shells exit at once; the inbox lists them once the PTY host has recorded it. */
export async function settled(h: Home): Promise<void> {
  if (h.name !== "full") return
  for (let i = 0; exits(h) < 2; i++) {
    if (i > 200) throw new Error("the Compare round's attempts never exited")
    await new Promise((r) => setTimeout(r, 100))
  }
}

function exits(h: Home): number {
  try {
    return Object.keys(JSON.parse(readFileSync(join(h.home, ".rove", "pty-exits.json"), "utf8"))).length
  } catch {
    return 0
  }
}

/** Stops the home's daemon and PTY host (the only processes it starts on its own). */
export function stopHome(h: Pick<Home, "env" | "roveDir">): void {
  try {
    execFileSync("bun", ["run", "scripts/dev-sandbox.ts", "reset"], { cwd: h.roveDir, env: h.env, stdio: "ignore" })
  } catch {
    // Nothing was running.
  }
}
