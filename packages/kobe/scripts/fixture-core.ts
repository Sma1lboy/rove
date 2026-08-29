/**
 * Shared isolation and seeding primitives for Rove test/dev fixtures.
 *
 * Three fixtures build an isolated Rove home, seed a throwaway git repo, and
 * create tasks with real chat tabs. They legitimately differ on `HOME` policy:
 * README capture keeps the operator's HOME so the real engine finds credentials,
 * while CI visual tests and the dev sandbox redirect HOME for determinism.
 * This module makes that policy explicit and pins every runtime path so a stray
 * inherited override cannot attach a fixture to the operator's live daemon.
 */

import { execFileSync } from "node:child_process"
import { readlinkSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join, resolve, sep } from "node:path"
import { setRoveEnv } from "@sma1lboy/kobe-daemon/compat-env"

export type HomePolicy = "redirect" | "keep"

export type FixturePorts = {
  daemonWebPort: number
  webPort?: number
  ptyPort?: number
}

export type FixturePaths = {
  root: string
  home: string
  repo: string
  configDir: string
  daemonSocket: string
  ptySocket: string
  daemonPidPath: string
  ptyPidPath: string
}

export type FixtureEnvConfig = {
  root: string
  home: string
  ports: FixturePorts
  homePolicy: HomePolicy
  parentEnv?: NodeJS.ProcessEnv
  extra?: Record<string, string>
}

export type RepoCommit = {
  message: string
  paths: readonly string[]
}

export type RepoFile = {
  path: string
  body: string
}

export type TaskSeed = {
  title: string
  repo: string
  prompt: string
  command?: string
}

/** Canonical ports for a fixture that runs a web server + daemon + PTY sidecar. */
export function fixturePortBase(base: number): FixturePorts {
  return { webPort: base, daemonWebPort: base + 1, ptyPort: base + 2 }
}

/** Runtime paths under a given fixture home. */
export function fixtureRuntimePaths(home: string): Omit<FixturePaths, "root" | "repo"> {
  const runtime = join(home, ".rove")
  return {
    home,
    configDir: join(home, ".config"),
    daemonSocket: join(runtime, "daemon.sock"),
    ptySocket: join(runtime, "pty.sock"),
    daemonPidPath: join(runtime, "daemon.pid"),
    ptyPidPath: join(runtime, "pty.pid"),
  }
}

/** Paths every isolated fixture derives from its scratch root. */
export function fixturePaths(root: string, repoName: string): FixturePaths {
  const { home, ...paths } = fixtureRuntimePaths(join(root, "home"))
  return { root, home, repo: join(root, repoName), ...paths }
}

/**
 * Claude Code marks its own child processes (`CLAUDECODE`,
 * `CLAUDE_CODE_CHILD_SESSION`, …). A fixture driven from inside a Rove task —
 * i.e. from inside Claude Code — leaks those markers down to the engine under
 * test, which then boots with "Transcript saving is off" and writes no session
 * file at all. The engine-owned history the chat pane renders comes from that
 * file, so the seeded workspace degrades to a raw terminal.
 */
export const CLAUDE_MARKERS: readonly string[] = [
  "CLAUDECODE",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_PID",
  "CLAUDE_EFFORT",
]

/**
 * Ambient names that would drag a fixture onto the operator's daemon or pin it
 * to the operator's session identity. Inherited values for these must be
 * dropped before stamping the fixture's own.
 */
export const FIXTURE_SCRUBBED_SUFFIXES: readonly string[] = [
  "DAEMON_SOCKET_PATH",
  "DAEMON_PID_PATH",
  "PTY_SOCKET_PATH",
  "PTY_PID_PATH",
  "TASK_ID",
  "TAB_ID",
  "TERMINAL_PTY",
  "HOME_DIR",
  "SANDBOX_HOME_DIR",
  "DAEMON_WEB_PORT",
  "SANDBOX_DAEMON_WEB_PORT",
  "WEB_PORT",
  "PTY_PORT",
]

/** Remove inherited markers and path/session overrides from a parent env. */
export function scrubFixtureEnv(parent: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(parent)) {
    if (value === undefined) continue
    if (CLAUDE_MARKERS.includes(key)) continue
    const suffix = key.startsWith("KOBE_") ? key.slice(5) : key.startsWith("ROVE_") ? key.slice(5) : null
    if (suffix !== null && FIXTURE_SCRUBBED_SUFFIXES.includes(suffix)) continue
    out[key] = value
  }
  return out
}

/**
 * Build a fixture child environment whose isolation invariants beat any
 * inherited production override. Both namespaces are stamped so a compatibility
 * alias can never outrank the fixture's own paths.
 */
export function buildFixtureEnv(config: FixtureEnvConfig): Record<string, string> {
  const env = scrubFixtureEnv(config.parentEnv ?? process.env)
  env.TERM = "xterm-256color"
  env.COLORTERM = "truecolor"

  if (config.homePolicy === "redirect") {
    env.HOME = config.home
    env.USERPROFILE = config.home
    env.XDG_CONFIG_HOME = join(config.home, ".config")
    env.XDG_DATA_HOME = join(config.home, ".local", "share")
    env.XDG_STATE_HOME = join(config.home, ".local", "state")
    env.XDG_CACHE_HOME = join(config.home, ".cache")
    env.XDG_RUNTIME_DIR = join(config.home, ".runtime")
  }

  const runtime = join(config.home, ".rove")
  setRoveEnv("HOME_DIR", config.home, env)
  setRoveEnv("SANDBOX_HOME_DIR", config.home, env)
  setRoveEnv("DAEMON_WEB_PORT", String(config.ports.daemonWebPort), env)
  setRoveEnv("SANDBOX_DAEMON_WEB_PORT", String(config.ports.daemonWebPort), env)
  if (config.ports.webPort !== undefined) setRoveEnv("WEB_PORT", String(config.ports.webPort), env)
  if (config.ports.ptyPort !== undefined) setRoveEnv("PTY_PORT", String(config.ports.ptyPort), env)

  // Pin sockets and pidfiles to the canonical fixture path. Deriving them from
  // HOME_DIR is not enough: `.kobe/` is the pre-rename runtime dir, and every
  // daemon bind drops a compatibility symlink there (`compat-link.ts`). A
  // daemon that binds while *_HOME_DIR points at the fixture but without a
  // pinned socket leaves `<fixture>/.kobe/daemon.sock` pointing at whatever
  // process bound last — sometimes the operator's real socket. An explicit
  // *_SOCKET_PATH override bypasses `runtimePath()` entirely.
  setRoveEnv("DAEMON_SOCKET_PATH", join(runtime, "daemon.sock"), env)
  setRoveEnv("PTY_SOCKET_PATH", join(runtime, "pty.sock"), env)
  setRoveEnv("DAEMON_PID_PATH", join(runtime, "daemon.pid"), env)
  setRoveEnv("PTY_PID_PATH", join(runtime, "pty.pid"), env)

  if (config.extra) Object.assign(env, config.extra)
  return env
}

/**
 * Fail loudly if the legacy `.kobe/daemon.sock` symlink under the fixture home
 * points outside the fixture root. Pinned sockets make the link inert for new
 * connections, so this is a tripwire for the state itself, not the connection.
 */
export function assertFixtureIsolation(home: string, fixtureRoot: string): void {
  const legacy = join(home, ".kobe", "daemon.sock")
  let target: string
  try {
    target = readlinkSync(legacy)
  } catch {
    return
  }
  const resolved = resolve(dirname(legacy), target)
  if (!resolved.startsWith(fixtureRoot + sep) && resolved !== fixtureRoot) {
    throw new Error(
      `fixture isolation breach: ${legacy} -> ${resolved} (outside ${fixtureRoot}). Some process bound a daemon while *_HOME_DIR named this fixture but the socket did not. Remove that link and re-run; every fixture caller must pin *_SOCKET_PATH.`,
    )
  }
}

/** Run a command in the fixture environment and return trimmed stdout. */
export function runInFixture(
  command: string,
  args: readonly string[],
  cwd: string,
  env: Record<string, string>,
): string {
  return execFileSync(command, [...args], { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
}

/** One `rove api` call through a given CLI path. */
export function runRoveApi(
  cliPath: string,
  args: readonly string[],
  cwd: string,
  env: Record<string, string>,
): unknown {
  return JSON.parse(runInFixture("bun", [cliPath, "api", ...args], cwd, env))
}

/** Seed a throwaway git repo with the given files and commit sequence. */
export type RepoIdentity = {
  email: string
  name: string
}

const DEFAULT_REPO_IDENTITY: RepoIdentity = { email: "fixture@rove.local", name: "Rove Fixture" }

export async function seedGitRepo(
  repoDir: string,
  files: readonly RepoFile[],
  commits: readonly RepoCommit[],
  env: Record<string, string>,
  identity: RepoIdentity = DEFAULT_REPO_IDENTITY,
): Promise<void> {
  await mkdir(repoDir, { recursive: true })
  runInFixture("git", ["init", "-q"], repoDir, env)
  runInFixture("git", ["config", "user.email", identity.email], repoDir, env)
  runInFixture("git", ["config", "user.name", identity.name], repoDir, env)
  const bodies = new Map(files.map((file) => [file.path, file.body]))
  for (const commit of commits) {
    for (const path of commit.paths) {
      const body = bodies.get(path)
      if (body === undefined) throw new Error(`seed commit references unknown file: ${path}`)
      await mkdir(dirname(join(repoDir, path)), { recursive: true })
      await writeFile(join(repoDir, path), body)
    }
    runInFixture("git", ["add", ...commit.paths], repoDir, env)
    runInFixture("git", ["commit", "-q", "-m", commit.message], repoDir, env)
  }
}

/**
 * Create a task and immediately open a chat tab on it.
 *
 * `rove api add` creates a task with no tabs, a shape the product never
 * produces on its own: a task exists because a session started. Seeded bare,
 * rows in the sidebar read as a mock-up, so every fixture task opens a real
 * engine tab. The prompt is deliberately trivial — enough to make the engine
 * boot and register the tab, not to produce work.
 */
export function createTaskWithChatTab(
  cliPath: string,
  task: TaskSeed,
  cwd: string,
  env: Record<string, string>,
  execArgs: readonly string[] = [],
): string {
  const command = task.command ?? "claude"
  const added = runRoveApiWithExecArgs(
    cliPath,
    ["add", "--repo", task.repo, "--title", task.title, "--command", command],
    cwd,
    env,
    execArgs,
  ) as {
    taskId?: string
  }
  if (!added.taskId) throw new Error(`fixture task not created: ${task.title}`)
  runRoveApiWithExecArgs(
    cliPath,
    ["send", "--task-id", added.taskId, "--tab", "new", "--command", command, "--plain", "--prompt", task.prompt],
    cwd,
    env,
    execArgs,
  )
  return added.taskId
}

function runRoveApiWithExecArgs(
  cliPath: string,
  args: readonly string[],
  cwd: string,
  env: Record<string, string>,
  execArgs: readonly string[],
): unknown {
  const out = runInFixture("bun", [...execArgs, cliPath, "api", ...args], cwd, env)
  return JSON.parse(out)
}
