/** Disposable evidence inputs; product UI and PTY implementations stay unmodified. */
import { execFileSync } from "node:child_process"
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises"
import { join, resolve } from "node:path"
import { stopDaemonProcess } from "@sma1lboy/kobe-daemon/daemon/lifecycle"
import {
  assertFixtureIsolation, buildFixtureEnv, fixturePaths, seedGitRepo, writeFixtureWebToken,
} from "../../kobe/scripts/fixture-core.ts"

export const REPO = resolve(import.meta.dirname, "../../..")
export const KOBE = join(REPO, "packages/kobe")
export const HARNESS = join(REPO, "packages/kobe-harness")
export const OUTPUT = join(HARNESS, "test-results/pr-evidence")
export const CLI = join(KOBE, "dist/cli/rove.js")

export function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

export async function makeFixture(name: string, port: number, welcome = false) {
  const paths = fixturePaths(join(REPO, ".scratch", `pr-evidence-${name}`), "fixture-repo")
  const env = buildFixtureEnv({
    root: paths.root, home: paths.home, ports: { webPort: port, ptyPort: port + 1 }, homePolicy: "redirect",
    // No ambient account, API token, vendor HOME, or production socket reaches this capture.
    parentEnv: { PATH: process.env.PATH, SHELL: "/bin/bash", LANG: "en_US.UTF-8", CI: "1" },
    extra: { ROVE_PTY_MAX_LIFETIME_MS: "600000", KOBE_PTY_MAX_LIFETIME_MS: "600000" },
  })
  const bin = join(paths.home, "bin")
  await mkdir(bin, { recursive: true })
  await mkdir(join(paths.configDir, "rove"), { recursive: true })
  await mkdir(env.XDG_RUNTIME_DIR!, { recursive: true, mode: 0o700 })
  env.PATH = `${bin}:${process.env.PATH ?? ""}`
  await writeFixtureWebToken(paths.home)
  const state: Record<string, unknown> = {
    activeTheme: "claude", themeMode: "dark", transparentBackground: false, locale: "en",
    defaultVendor: "codex", skillHintSeen: "1", savedRepos: [paths.repo],
  }
  const skill = await readFile(join(KOBE, "dist/skills/rove/SKILL.md"), "utf8")
  const skillVersion = skill.match(/rove-skill-version:\s*(\d+)/)?.[1]
  if (skillVersion) state[`skillHintSeen:v${skillVersion}`] = "1"
  if (!welcome) {
    state.welcomed = true
    state["app.lastRunVersion"] = JSON.parse(await readFile(join(KOBE, "package.json"), "utf8")).version
  }
  await writeFile(join(paths.configDir, "rove/state.json"), JSON.stringify(state, null, 2))
  // An explicitly named fixture process, not a simulated Rove screen or a real account.
  await writeFile(join(bin, "codex"), `#!/bin/sh\nif [ "$1" = "--version" ]; then echo 'codex fixture'; exit 0; fi\nprintf 'PR evidence: fixture engine process (no account or model)\\n› '\nwhile IFS= read -r line; do printf '\\nfixture received input\\n› '; done\n`)
  await chmod(join(bin, "codex"), 0o755)
  await seedGitRepo(paths.repo, [{ path: "README.md", body: "# PR evidence fixture\n" }],
    [{ message: "fixture", paths: ["README.md"] }], env)
  const wrapper = join(paths.root, "launch.sh")
  await writeFile(wrapper, `#!/bin/sh\n${Object.entries(env).map(([key, value]) => `export ${key}=${quote(value)}`).join("\n")}\ncd ${quote(KOBE)}\nexec ${quote(process.execPath)} run dev:sandbox\n`)
  await chmod(wrapper, 0o755)
  assertFixtureIsolation(paths.home, paths.root)
  const run = (args: string[], input?: string, extra?: Record<string, string>) => execFileSync(process.execPath, [CLI, ...args], {
    cwd: KOBE, env: { ...env, ...extra }, encoding: "utf8", input, timeout: 60_000,
  }).trim()
  const api = (args: string[]) => JSON.parse(run(["api", ...args]))
  const children: ReturnType<typeof Bun.spawn>[] = []
  function spawn(args: string[], file: string, cwd = HARNESS, extra: Record<string, string> = {}) {
    const child = Bun.spawn(args, { cwd, env: { ...env, ...extra }, stdout: Bun.file(join(OUTPUT, `${name}-${file}.log`)), stderr: Bun.file(join(OUTPUT, `${name}-${file}-stderr.log`)) })
    children.push(child)
    return child
  }
  async function start() {
    spawn([process.execPath, "x", "vite", "dev", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], "vite")
    spawn(["node", "pty-server.mjs"], "sidecar", HARNESS, {
      KOBE_PTY_DEV_CWD: KOBE, KOBE_PTY_DEV_COMMAND: quote(wrapper), KOBE_PTY_PORT: String(port + 1),
    })
  }
  async function stop() {
    for (const child of children) child.kill()
    await Promise.all(children.map((child) => child.exited))
    await stopDaemonProcess(paths.daemonSocket, paths.daemonPidPath)
    await stopDaemonProcess(paths.ptySocket, paths.ptyPidPath)
  }
  return { paths, env, port, run, api, start, stop }
}

export type EvidenceFixture = Awaited<ReturnType<typeof makeFixture>>
