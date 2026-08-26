/**
 * Isolated per-name plugin sandbox — the harness for developing, demoing,
 * and recording plugins without touching the shared `dev:sandbox` home or
 * any other sandbox running in parallel (fan-out tasks each pick a name).
 *
 * Isolation per name: own home under `.scratch/plugin-sandbox/<name>/home`
 * (gitignored, primary checkout — shared worktree-safe like dev-sandbox),
 * own daemon + PTY host sockets (derived from the home), own web port
 * (hashed from the name into 5300-5999, or ROVE_SANDBOX_DAEMON_WEB_PORT),
 * own plugin registry. Ambient production socket overrides are dropped the
 * same way dev-sandbox does.
 *
 *   bun run scripts/plugin-sandbox.ts <name> link <dir…>   register local plugin(s)
 *   bun run scripts/plugin-sandbox.ts <name> run           TUI in the sandbox (recording surface)
 *   bun run scripts/plugin-sandbox.ts <name> api <args…>   rove api against the sandbox
 *   bun run scripts/plugin-sandbox.ts <name> smoketest     link hello-events, fire an event, assert it landed
 *   bun run scripts/plugin-sandbox.ts <name> home          print the home path
 *   bun run scripts/plugin-sandbox.ts <name> reset         stop the sandbox daemon + PTY host
 */

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { stopDaemonProcess } from "@sma1lboy/kobe-daemon/daemon/lifecycle"
import {
  defaultDaemonPidPath,
  defaultDaemonSocketPath,
  defaultPtyHostPidPath,
  defaultPtyHostSocketPath,
} from "@sma1lboy/kobe-daemon/daemon/paths"
import { readPluginManifest } from "@sma1lboy/kobe-daemon/plugins/manifest"
import { pluginStateDir } from "@sma1lboy/kobe-daemon/plugins/plugin-paths"
import { loadPluginRegistry, savePluginRegistry, upsertPluginEntry } from "@sma1lboy/kobe-daemon/plugins/registry"
import { sandboxChildEnv } from "./dev-sandbox-args.ts"

const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/

function usage(): never {
  console.error("usage: bun run scripts/plugin-sandbox.ts <name> <link <dir…>|run|api <args…>|smoketest|home|reset>")
  process.exit(2)
}

async function gitCommonDir(): Promise<string> {
  const r = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" })
  if (r.status !== 0) {
    console.error(r.stderr)
    process.exit(r.status ?? 1)
  }
  return r.stdout.trim()
}

/** Deterministic per-name web port in 5300-5999 — parallel sandboxes don't collide. */
function portFor(name: string): number {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return 5300 + (h % 700)
}

const [name, verb, ...rest] = process.argv.slice(2)
if (!name || !NAME_RE.test(name) || !verb) usage()

const repoRoot = dirname(await gitCommonDir())
const home = join(repoRoot, "packages", "kobe", ".scratch", "plugin-sandbox", name, "home")
await mkdir(home, { recursive: true })

const env = sandboxChildEnv(home)
env.ROVE_SANDBOX_DAEMON_WEB_PORT ??= String(portFor(name))
env.ROVE_DAEMON_WEB_PORT = env.ROVE_SANDBOX_DAEMON_WEB_PORT
env.KOBE_DAEMON_WEB_PORT = env.ROVE_SANDBOX_DAEMON_WEB_PORT

const ROVE_CLI = join(repoRoot, "packages", "kobe", "src", "cli", "rove.ts")

function rove(args: readonly string[], opts: { inherit?: boolean } = {}): { code: number; stdout: string } {
  const r = spawnSync(process.execPath, ["--conditions=browser", ROVE_CLI, ...args], {
    cwd: join(repoRoot, "packages", "kobe"),
    env,
    encoding: "utf8",
    stdio: opts.inherit ? "inherit" : ["ignore", "pipe", "inherit"],
    timeout: 120_000,
  })
  return { code: r.status ?? 1, stdout: (r.stdout as string | null) ?? "" }
}

/** Register plugin dirs straight into THIS sandbox's registry (link semantics). */
function linkDirs(dirs: readonly string[]): string[] {
  if (dirs.length === 0) usage()
  let registry = loadPluginRegistry(home)
  const ids: string[] = []
  for (const dir of dirs) {
    const root = resolve(dir)
    const { manifest, warnings } = readPluginManifest(root)
    for (const w of warnings) console.error(`[plugin-sandbox] warning: ${w}`)
    registry = upsertPluginEntry(registry, {
      id: manifest.id,
      source: { kind: "link" },
      root,
      enabled: true,
      version: manifest.version,
      installedAt: Date.now(),
    })
    ids.push(manifest.id)
    console.error(`[plugin-sandbox:${name}] linked ${manifest.id} → ${root}`)
  }
  savePluginRegistry(registry, home)
  return ids
}

async function stopSandbox(): Promise<void> {
  await stopDaemonProcess(defaultDaemonSocketPath(home), defaultDaemonPidPath(home))
  await stopDaemonProcess(defaultPtyHostSocketPath(home), defaultPtyHostPidPath(home))
}

async function smoketest(): Promise<never> {
  const exampleDir = join(repoRoot, "packages", "kobe-plugin-sdk", "examples", "hello-events")
  const [id] = linkDirs([exampleDir])
  const eventsFile = join(pluginStateDir(id as string, home), "events.jsonl")

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

  // Fresh daemon so the just-linked registry is loaded, then fire an event
  // the plugin subscribed to. issue-create → issue.changed (no worktree,
  // no engine — the cheapest end-to-end plugin event there is).
  await stopSandbox()
  const created = rove(["api", "issue-create", "--repo", repo, "--title", `smoke ${Date.now()}`])
  if (created.code !== 0) {
    console.error(`[plugin-sandbox:${name}] SMOKETEST FAIL — issue-create exited ${created.code}`)
    process.exit(1)
  }

  // The hook is an async spawned process; poll its output file.
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      const lines = readFileSync(eventsFile, "utf8").trim().split("\n")
      const hit = lines.map((l) => JSON.parse(l) as { event: string }).find((e) => e.event === "issue.changed")
      if (hit) {
        console.log(`[plugin-sandbox:${name}] SMOKETEST PASS — issue.changed reached ${id} (${eventsFile})`)
        await stopSandbox()
        process.exit(0)
      }
    } catch {
      /* not written yet */
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  console.error(`[plugin-sandbox:${name}] SMOKETEST FAIL — no issue.changed in ${eventsFile} after 15s`)
  console.error(`[plugin-sandbox:${name}] check ${join(home, ".rove", "daemon.log")} and the plugin's log.jsonl`)
  process.exit(1)
}

console.error(`[plugin-sandbox:${name}] home: ${home} (web port ${env.ROVE_SANDBOX_DAEMON_WEB_PORT})`)

switch (verb) {
  case "home":
    console.log(home)
    break
  case "link":
    linkDirs(rest)
    break
  case "run":
    process.exit(rove(rest, { inherit: true }).code)
    break
  case "api":
    process.exit(rove(["api", ...rest], { inherit: true }).code)
    break
  case "smoketest":
    await smoketest()
    break
  case "reset":
    await stopSandbox()
    console.error(`[plugin-sandbox:${name}] stopped daemon and PTY host`)
    break
  default:
    usage()
}
