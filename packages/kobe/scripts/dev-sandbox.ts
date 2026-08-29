/**
 * Dev sandbox — run rove against a throwaway home instead of production.
 *
 *   bun dev:sandbox                          # TUI, shared default sandbox home
 *   bun dev:sandbox run api list             # any rove argv in the sandbox env
 *   bun dev:sandbox run plugin link <dir>    # plugins register into THIS home's registry
 *   bun dev:sandbox --name ex-a run …        # named instance: own home/daemon/port
 *   bun dev:sandbox --name ex-a smoketest    # plugin-event end-to-end self-check
 *   bun dev:sandbox [--name x] seed          # a few tasks, each with a chat tab
 *   bun dev:sandbox [--name x] home|reset
 *
 * A named instance (`--name`) lives under `.dev-sandbox/named/<name>/home`
 * with its own daemon, PTY host, plugin registry, and a stable per-name web
 * port — so parallel tasks each sandbox their own plugins without colliding
 * with each other or the shared default home. Plugin configuration needs no
 * special verbs: `run plugin link/install/…` is the ordinary plugin CLI
 * running with the sandbox HOME_DIR, and the sandbox daemon file-watches its
 * registry, so links apply live.
 */

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { readRoveEnv } from "@sma1lboy/kobe-daemon/compat-env"
import { stopDaemonProcess } from "@sma1lboy/kobe-daemon/daemon/lifecycle"
import {
  defaultDaemonPidPath,
  defaultDaemonSocketPath,
  defaultPtyHostPidPath,
  defaultPtyHostSocketPath,
} from "@sma1lboy/kobe-daemon/daemon/paths"
import { pluginStateDir } from "@sma1lboy/kobe-daemon/plugins/plugin-paths"
import { parseSandboxArgs, sandboxChildEnv } from "./dev-sandbox-args.ts"

function usageError(err: unknown): never {
  console.error(err instanceof Error ? err.message : String(err))
  console.error("usage: bun run scripts/dev-sandbox.ts [--name <x>] [run [rove argv…]|reset|home|smoketest]")
  process.exit(2)
}

async function gitCommonDir(): Promise<string> {
  const proc = Bun.spawn(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], {
    stdout: "pipe",
    stderr: "inherit",
  })
  const stdout = await new Response(proc.stdout).text()
  const code = await proc.exited
  if (code !== 0) process.exit(code)
  return stdout.trim()
}

async function sandboxHome(name?: string): Promise<string> {
  const explicit = readRoveEnv("SANDBOX_HOME_DIR")?.trim()
  if (explicit) return explicit

  // Share one dev sandbox across git worktrees. `git-common-dir` points at
  // the primary checkout's `.git`, even when this script runs from a Rove
  // task worktree, so every sandbox run sees the same task store. Named
  // instances nest under the same root, one home per name.
  const repoRoot = dirname(await gitCommonDir())
  const base = join(repoRoot, "packages", "kobe", ".dev-sandbox")
  return name ? join(base, "named", name, "home") : join(base, "home")
}

let parsed: ReturnType<typeof parseSandboxArgs>
try {
  parsed = parseSandboxArgs(process.argv.slice(2))
} catch (err) {
  usageError(err)
}
const { mode, name, roveArgs } = parsed
const home = await sandboxHome(name)

if (mode === "home") {
  console.log(home)
  process.exit(0)
}

await mkdir(home, { recursive: true })
const label = name ? `dev:sandbox ${name}` : "dev:sandbox"
console.error(`[rove ${label}] home: ${home}`)

// Isolate the sandbox daemon's home and web port from production. Both env
// namespaces are stamped so a child wrapper cannot revive an ambient value.
const env = sandboxChildEnv(home, process.env, name)

async function stopSandbox(): Promise<void> {
  await stopDaemonProcess(defaultDaemonSocketPath(home), defaultDaemonPidPath(home))
  await stopDaemonProcess(defaultPtyHostSocketPath(home), defaultPtyHostPidPath(home))
}

if (mode === "reset") {
  await stopSandbox()
  console.error(`[rove ${label}] stopped daemon and PTY host`)
  process.exit(0)
}

function runRove(argv: readonly string[], stdio: "inherit" | "pipe" = "inherit"): { code: number; stdout: string } {
  const r = spawnSync(process.execPath, ["--conditions=browser", "./src/cli/rove.ts", ...argv], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
    stdio: stdio === "inherit" ? "inherit" : ["ignore", "pipe", "inherit"],
    timeout: mode === "smoketest" ? 120_000 : undefined,
  })
  return { code: r.status ?? 1, stdout: (r.stdout as string | null) ?? "" }
}

/**
 * Fill an empty sandbox with tasks that look like a sandbox someone has been
 * USING: a couple of repos' worth of work, each task carrying a chat tab.
 *
 * A bare `add` creates a task with no tabs, which is a shape the product never
 * produces on its own — a task comes into existence by starting a session. A
 * sandbox seeded that way shows childless rows and reads as a mock-up, so each
 * task here opens a real engine tab. The prompt is deliberately trivial: it
 * exists to make the engine boot and register the tab, not to produce work.
 */
async function seed(): Promise<never> {
  const repo = dirname(await gitCommonDir())
  const TASKS: readonly { readonly title: string; readonly prompt: string }[] = [
    { title: "Trace the engine handshake", prompt: "In one line: what does this repo do?" },
    { title: "Audit the daemon's restart path", prompt: "In one line: name the package manager this repo uses." },
    { title: "Tidy the sidebar keybindings", prompt: "In one line: what runtime does this repo target?" },
  ]
  const listed = JSON.parse(runRove(["api", "list"], "pipe").stdout || "{}") as {
    tasks?: { title?: string }[]
  }
  const existing = new Set((listed.tasks ?? []).map((task) => task.title))

  for (const task of TASKS) {
    if (existing.has(task.title)) {
      console.error(`[rove ${label}] reusing ${task.title}`)
      continue
    }
    const added = JSON.parse(
      runRove(["api", "add", "--repo", repo, "--title", task.title, "--command", "claude"], "pipe").stdout || "{}",
    ) as { taskId?: string }
    if (!added.taskId) {
      console.error(`[rove ${label}] could not create ${task.title}`)
      continue
    }
    // `--tab new` is what actually creates the tab; `add` alone leaves the
    // task childless.
    runRove(
      [
        "api",
        "send",
        "--task-id",
        added.taskId,
        "--tab",
        "new",
        "--command",
        "claude",
        "--plain",
        "--prompt",
        task.prompt,
      ],
      "pipe",
    )
    console.error(`[rove ${label}] seeded ${task.title}`)
  }
  console.error(`[rove ${label}] seeded ${TASKS.length} task(s) with chat tabs`)
  process.exit(0)
}

if (mode === "seed") await seed()

/**
 * End-to-end plugin-event self-check: link the SDK's hello-events example
 * into this sandbox's registry, boot a fresh daemon, fire `issue.changed`
 * via `issue-create`, and assert the hook recorded it. Proves the whole
 * chain — registry, PluginHost, event dispatch, env contract — before a
 * task builds anything on top.
 */
async function smoketest(): Promise<never> {
  const repoRoot = dirname(await gitCommonDir())
  const exampleDir = join(repoRoot, "packages", "kobe-plugin-sdk", "examples", "hello-events")
  const linked = runRove(["plugin", "link", exampleDir])
  if (linked.code !== 0) {
    console.error(`[rove ${label}] SMOKETEST FAIL — plugin link exited ${linked.code}`)
    process.exit(1)
  }
  const eventsFile = join(pluginStateDir("examples.hello-events", home), "events.jsonl")

  // A scratch git repo — the issue store keys by git common dir.
  const repo = join(home, "smoke-repo")
  if (!existsSync(join(repo, ".git"))) {
    await mkdir(repo, { recursive: true })
    for (const args of [
      ["init", "-q"],
      ["config", "user.email", "smoke@sandbox.local"],
      ["config", "user.name", "smoke"],
    ]) {
      const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" })
      if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`)
    }
  }

  // Fresh daemon so the just-linked registry loads at startup.
  await stopSandbox()
  const created = runRove(["api", "issue-create", "--repo", repo, "--title", `smoke ${Date.now()}`], "pipe")
  if (created.code !== 0) {
    console.error(`[rove ${label}] SMOKETEST FAIL — issue-create exited ${created.code}`)
    process.exit(1)
  }

  // The hook is an async spawned process; poll its output file.
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      const lines = readFileSync(eventsFile, "utf8").trim().split("\n")
      const hit = lines.map((l) => JSON.parse(l) as { event: string }).find((e) => e.event === "issue.changed")
      if (hit) {
        console.log(`[rove ${label}] SMOKETEST PASS — issue.changed reached examples.hello-events (${eventsFile})`)
        await stopSandbox()
        process.exit(0)
      }
    } catch {
      /* not written yet */
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  console.error(`[rove ${label}] SMOKETEST FAIL — no issue.changed in ${eventsFile} after 15s`)
  console.error(`[rove ${label}] check ${join(home, ".rove", "daemon.log")} and the plugin's log.jsonl`)
  process.exit(1)
}

if (mode === "smoketest") await smoketest()

// `run` with argv execs that rove command in the sandbox env; bare `run`
// starts the TUI, exactly as before.
const child = Bun.spawn([process.execPath, "--conditions=browser", "./src/cli/rove.ts", ...roveArgs], {
  cwd: process.cwd(),
  env,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
})
process.exit(await child.exited)
