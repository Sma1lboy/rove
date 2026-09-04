import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { isProcessAlive } from "@sma1lboy/kobe-daemon/daemon/lifecycle"
import { basename, join, relative, resolve, sep } from "node:path"
import {
  assertFixtureIsolation,
  buildFixtureEnv,
  fixturePaths,
  fixturePortBase,
  runInFixture,
  fixtureAuthHeaders,
  runRoveApi,
  seedGitRepo,
  writeFixtureWebToken,
  type FixturePaths,
  type FixturePorts,
} from "../../kobe/scripts/fixture-core.ts"

const REPO_ROOT = resolve(import.meta.dirname, "../../..")
export const KOBE_DIR: string = join(REPO_ROOT, "packages", "kobe")
export const ROVE_CLI = join(KOBE_DIR, "dist", "cli", "rove.js")
export const ROVE_SKILL = join(KOBE_DIR, "dist", "skills", "rove", "SKILL.md")

export const VISUAL_PORT_BASE = Number.parseInt(process.env.KOBE_VISUAL_PORT_BASE ?? "5273", 10)
const PORTS: FixturePorts = fixturePortBase(VISUAL_PORT_BASE)
export const VISUAL_WEB_PORT = PORTS.webPort!
export const VISUAL_DAEMON_PORT = PORTS.daemonWebPort
export const VISUAL_PTY_PORT = PORTS.ptyPort!
export const VISUAL_RUN_ID = `p${VISUAL_PORT_BASE}`

export const VISUAL_ROOT = join(REPO_ROOT, ".scratch", `opentui-visual-${VISUAL_PORT_BASE}`)
const PATHS: FixturePaths = fixturePaths(VISUAL_ROOT, "fixture-repo")
export const VISUAL_HOME = PATHS.home
const VISUAL_REPO = PATHS.repo
const XDG_CONFIG_HOME = PATHS.configDir
const XDG_DATA_HOME = join(VISUAL_HOME, ".local", "share")
const XDG_STATE_HOME = join(VISUAL_HOME, ".local", "state")
const XDG_CACHE_HOME = join(VISUAL_HOME, ".cache")
const XDG_RUNTIME_DIR = join(VISUAL_HOME, ".runtime")

// Kanban cards render their `created` date, so the screenshot gate breaks at
// every midnight unless the stamp is pinned. Must match the committed
// sandbox.spec.ts-snapshots; whichever process starts the daemon wins, so the
// pin rides both VISUAL_ENV and the PTY command.
const VISUAL_TODAY = "2026-07-15"

/** Backstop life ceiling for fixture daemons and PTY hosts (`pty-server.ts`).
 *  Generous next to a ~15s journey, short next to the two DAYS the stranded
 *  hosts reached. Deliberately absent from production and the interactive
 *  `dev:sandbox`, where a long-lived host is somebody's live environment. */
const VISUAL_PTY_MAX_LIFETIME_MS = String(30 * 60 * 1000)

/** Re-exported so the capture scripts reach the fixture's PTY sidecar (now
 *  token-gated) through the same module that owns its ports. */
export { fixtureAuthHeaders }

export const VISUAL_ENV = buildFixtureEnv({
  root: VISUAL_ROOT,
  home: VISUAL_HOME,
  ports: PORTS,
  homePolicy: "redirect",
  extra: {
    ROVE_ISSUES_TODAY: VISUAL_TODAY,
    KOBE_ISSUES_TODAY: VISUAL_TODAY,
    // A fixture host has no business outliving the run that made it. Teardown
    // below is the primary reaper; this is the backstop for the run that never
    // reaches teardown at all (a killed harness, an interrupted Playwright).
    ROVE_PTY_MAX_LIFETIME_MS: VISUAL_PTY_MAX_LIFETIME_MS,
    KOBE_PTY_MAX_LIFETIME_MS: VISUAL_PTY_MAX_LIFETIME_MS,
  },
})

// Inlined into the PTY command: the child runs under `/bin/sh -lc`, and a
// login shell or env-passing gap must NEVER let it fall back to the shared
// `.dev-sandbox/home` (the owner's live environment).
//
// The explicit path assignments pin the fixture's runtime files under its
// own home. A kobe engine session exports KOBE_DAEMON_SOCKET_PATH into its
// terminal so in-task agents can reach the owning daemon -- which means an
// agent running this suite from inside a kobe task would otherwise hand the
// fixture TUI a socket pointing at the OWNER'S live daemon, and the
// "isolated" journey renders real tasks.
export const VISUAL_PTY_COMMAND = `${[
  `HOME=${VISUAL_HOME}`,
  `XDG_CONFIG_HOME=${XDG_CONFIG_HOME}`,
  `ROVE_SANDBOX_HOME_DIR=${VISUAL_HOME}`,
  `KOBE_SANDBOX_HOME_DIR=${VISUAL_HOME}`,
  `ROVE_HOME_DIR=${VISUAL_HOME}`,
  `KOBE_HOME_DIR=${VISUAL_HOME}`,
  `ROVE_DAEMON_WEB_PORT=${VISUAL_DAEMON_PORT}`,
  `KOBE_DAEMON_WEB_PORT=${VISUAL_DAEMON_PORT}`,
  `ROVE_ISSUES_TODAY=${VISUAL_TODAY}`,
  `KOBE_ISSUES_TODAY=${VISUAL_TODAY}`,
  `ROVE_DAEMON_SOCKET_PATH=${PATHS.daemonSocket}`,
  `KOBE_DAEMON_SOCKET_PATH=${PATHS.daemonSocket}`,
  `ROVE_DAEMON_PID_PATH=${PATHS.daemonPidPath}`,
  `KOBE_DAEMON_PID_PATH=${PATHS.daemonPidPath}`,
  `ROVE_PTY_SOCKET_PATH=${PATHS.ptySocket}`,
  `KOBE_PTY_SOCKET_PATH=${PATHS.ptySocket}`,
  `ROVE_PTY_PID_PATH=${PATHS.ptyPidPath}`,
  `KOBE_PTY_PID_PATH=${PATHS.ptyPidPath}`,
  "ROVE_TASK_ID=",
  "KOBE_TASK_ID=",
  "ROVE_TAB_ID=",
  "KOBE_TAB_ID=",
  // Opt-in PATH override for capturing the "nothing installed" states. Only
  // the contrib engines resolve through `Bun.which`, so a stripped PATH is the
  // one lever that hides them; the built-ins have their own finders and stay
  // visible as installed-but-not-logged-in, which is what the onboarding
  // wizard's not-ready verdict needs. Absent by default — a fixture with no
  // engines is not the state most journeys want.
  ...(process.env.KOBE_VISUAL_MIN_PATH ? [`PATH=${process.env.KOBE_VISUAL_MIN_PATH}`] : []),
].join(" ")} bun run dev:sandbox`

/** Bump when the fixture shape changes so warm reuse rebuilds. */
const FIXTURE_VERSION = "5"
const FIXTURE_MARKER = join(VISUAL_ROOT, "fixture-ok")

function assertSafeVisualRoot(): void {
  const scratch = join(REPO_ROOT, ".scratch")
  const insideScratch = relative(scratch, VISUAL_ROOT)
  if (insideScratch.startsWith(`..${sep}`) || insideScratch === ".." || basename(VISUAL_ROOT) !== `opentui-visual-${VISUAL_PORT_BASE}`) {
    throw new Error(`refusing visual fixture cleanup outside .scratch: ${VISUAL_ROOT}`)
  }
}

function run(command: string, args: readonly string[], cwd: string = KOBE_DIR): string {
  return runInFixture(command, args, cwd, VISUAL_ENV)
}

function runRove(args: readonly string[]): unknown {
  return runRoveApi(ROVE_CLI, args, KOBE_DIR, VISUAL_ENV)
}

function createdIssueId(value: unknown, title: string): number {
  const issues = (value as { issues?: Array<{ id?: unknown; title?: unknown }> }).issues
  const id = issues?.find((issue) => issue.title === title)?.id
  if (typeof id !== "number") throw new Error(`visual fixture did not create issue: ${title}`)
  return id
}

async function seedStartupState(): Promise<void> {
  const packageJson = JSON.parse(await readFile(join(KOBE_DIR, "package.json"), "utf8")) as { version: string }
  let skillVersion: string | undefined
  try {
    const skill = await readFile(ROVE_SKILL, "utf8")
    skillVersion = skill.match(/rove-skill-version:\s*(\d+)/)?.[1]
  } catch {
    skillVersion = undefined
  }

  const state: Record<string, string | boolean | string[]> = {
    "app.lastRunVersion": packageJson.version,
    onboarded: true,
    skillHintSeen: "1",
    // The Worktrees page audits saved projects rather than task rows. Keep
    // the fixture repo in this independent registry so that visual journey
    // exercises the real daemon-backed audit instead of its empty state.
    savedRepos: [VISUAL_REPO],
  }
  if (skillVersion) state[`skillHintSeen:v${skillVersion}`] = "1"
  const stateDir = join(XDG_CONFIG_HOME, "rove")
  await mkdir(stateDir, { recursive: true })
  await writeFile(join(stateDir, "state.json"), `${JSON.stringify(state, null, 2)}\n`)
}

/** Pid a runtime pidfile names right now, or null when absent/unreadable. */
async function pidFromFile(path: string): Promise<number | null> {
  try {
    const pid = Number.parseInt((await readFile(path, "utf8")).trim(), 10)
    return Number.isInteger(pid) && pid > 1 ? pid : null
  } catch {
    return null
  }
}

/**
 * Teardown must PROVE it cleaned up. `rm -rf VISUAL_ROOT` deletes the socket
 * and pidfile that are the only handles anyone has on the fixture's daemon and
 * PTY host, so a reset that quietly failed used to leave a running process
 * nothing could ever address again — and the deletion erased the evidence
 * that it had. Read the pids BEFORE the delete, check them after, and say so
 * out loud when one survived.
 */
async function assertFixtureProcessesGone(pids: ReadonlyMap<string, number>): Promise<void> {
  const survivors: string[] = []
  for (const [role, pid] of pids) {
    // A dying process can take a moment past its socket close.
    for (let attempt = 0; attempt < 10 && isProcessAlive(pid); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    if (isProcessAlive(pid)) survivors.push(`${role} (pid ${pid})`)
  }
  if (survivors.length === 0) return
  throw new Error(
    `visual fixture teardown leaked ${survivors.join(", ")}: the process outlived its home ${VISUAL_ROOT}, ` +
      "whose socket and pidfile are now deleted, so nothing can address it. Kill it by the pid above.",
  )
}

export async function cleanupVisualFixture(): Promise<void> {
  assertSafeVisualRoot()
  assertFixtureIsolation(VISUAL_HOME, VISUAL_ROOT)
  // Kill the harness TUI first: globalTeardown runs BEFORE Playwright stops
  // the PTY sidecar, and a live TUI auto-restarts the daemon right after our
  // reset -- leaking a detached daemon whose home we are about to delete.
  await fetch(`http://127.0.0.1:${VISUAL_PTY_PORT}/pty/close`, {
    method: "POST",
    headers: { "content-type": "application/json", ...fixtureAuthHeaders() },
    body: JSON.stringify({ tab: `visual-${VISUAL_RUN_ID}` }),
  }).catch(() => {})
  await new Promise((resolve) => setTimeout(resolve, 500))
  // Read the addresses BEFORE reset or rm can remove them; verified after.
  const owners = new Map<string, number>()
  for (const [role, path] of [
    ["daemon", PATHS.daemonPidPath],
    ["pty host", PATHS.ptyPidPath],
  ] as const) {
    const pid = await pidFromFile(path)
    if (pid !== null) owners.set(role, pid)
  }
  try {
    run("bun", ["run", "dev:sandbox:reset"])
  } finally {
    // Teardown runs before Playwright stops the PTY sidecar, so the sandbox
    // TUI can still be flushing state -- retry until its writers are gone.
    for (let attempt = 0; ; attempt += 1) {
      try {
        await rm(VISUAL_ROOT, { recursive: true, force: true })
        break
      } catch (error) {
        if (attempt >= 10) throw error
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
    }
  }
  await assertFixtureProcessesGone(owners)
}

/** Warm-path probe: marker matches and the fixture daemon still answers. */
async function fixtureIsWarm(): Promise<boolean> {
  if (process.env.KOBE_VISUAL_FRESH === "1") return false
  try {
    if ((await readFile(FIXTURE_MARKER, "utf8")).trim() !== FIXTURE_VERSION) return false
    // `rove api list` auto-starts the fixture daemon when it idled out.
    const listed = runRove(["list"]) as { tasks?: Array<{ title?: unknown }> }
    return listed.tasks?.some((task) => task.title === "Visual Fixture") ?? false
  } catch {
    return false
  }
}

export default async function setupVisualFixture(): Promise<void> {
  assertFixtureIsolation(VISUAL_HOME, VISUAL_ROOT)
  if (await fixtureIsWarm()) return
  await cleanupVisualFixture()
  await Promise.all(
    [VISUAL_HOME, VISUAL_REPO, XDG_CONFIG_HOME, XDG_DATA_HOME, XDG_STATE_HOME, XDG_CACHE_HOME, XDG_RUNTIME_DIR].map((dir) =>
      mkdir(dir, { recursive: true }),
    ),
  )
  await chmod(XDG_RUNTIME_DIR, 0o700)
  // Before the first command that can start the fixture daemon.
  await writeFixtureWebToken(VISUAL_HOME)
  await seedStartupState()

  await seedGitRepo(
    VISUAL_REPO,
    [{ path: "README.md", body: "# OpenTUI visual fixture\n" }],
    [{ message: "fixture", paths: ["README.md"] }],
    VISUAL_ENV,
    { email: "visual@kobe.local", name: "kobe visual" },
  )

  // Bare task, NO chat tab. The journeys assert the sidebar row label
  // "Visual Fixture", which a seeded engine tab overwrites with its own
  // first-turn title — and CI has no engine binary at all, so the tab would
  // boot straight into the code-127 dead-engine state (issue #79). The
  // pre-fixture-core seeding did exactly this bare `add`; only hero fixtures
  // (which run where a real engine exists) seed chat tabs.
  const added = runRove([
    "add",
    "--repo",
    VISUAL_REPO,
    "--title",
    "Visual Fixture",
    "--command",
    "claude",
    "--activate",
  ]) as { taskId?: unknown }
  if (typeof added.taskId !== "string") throw new Error("visual fixture task creation returned no taskId")
  const taskId = added.taskId

  const backlogTitle = "Backlog fixture"
  const progressTitle = "In progress fixture"
  const doneTitle = "Done fixture"
  createdIssueId(
    runRove(["issue-create", "--repo", VISUAL_REPO, "--title", backlogTitle, "--body", "Waiting to start."]),
    backlogTitle,
  )
  const progressId = createdIssueId(
    runRove(["issue-create", "--repo", VISUAL_REPO, "--title", progressTitle, "--body", "Work is active."]),
    progressTitle,
  )
  runRove(["issue-update", "--repo", VISUAL_REPO, "--id", String(progressId), "--task", taskId])
  const doneId = createdIssueId(
    runRove(["issue-create", "--repo", VISUAL_REPO, "--title", doneTitle, "--body", "Work is complete."]),
    doneTitle,
  )
  runRove(["issue-set-status", "--repo", VISUAL_REPO, "--id", String(doneId), "--status", "done"])
  runRove(["set-active", "--task-id", taskId])
  await writeFile(FIXTURE_MARKER, `${FIXTURE_VERSION}\n`)
}
