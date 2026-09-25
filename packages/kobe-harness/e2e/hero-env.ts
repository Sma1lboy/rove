/**
 * Isolated environment for the README/docs capture stack ("hero" fixture).
 *
 * Same ground-truth path as `visual:serve` (fixed browser `/harness` ->
 * xterm.js -> PTY sidecar -> real OpenTUI), but pointed at a RICHER throwaway
 * home: a realistic repo, several tasks, and REAL engine sessions, because
 * the barren visual fixture photographs as an empty workspace.
 *
 * One deliberate difference from `visual-fixture.ts`: `HOME` stays the
 * operator's own. The engine under capture is the real `claude` binary and it
 * reads its credentials from `$HOME/.claude`; a redirected home would
 * photograph a login screen. Rove's OWN state is still fully isolated.
 *
 * Isolation primitives live in `packages/kobe/scripts/fixture-core.ts`;
 * this file only wires them to the hero-specific paths and `HOME` policy.
 */

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import {
  assertFixtureIsolation,
  buildFixtureEnv,
  CLAUDE_MARKERS,
  fixtureAuthHeaders,
  fixturePaths,
  fixturePortBase,
  type FixturePaths,
  type FixturePorts,
} from "../../kobe/scripts/fixture-core.ts"

/** Re-exported so the capture scripts reach the hero PTY sidecar (now
 *  token-gated) through the same module that owns its ports. */
export { fixtureAuthHeaders }

const REPO_ROOT = resolve(import.meta.dirname, "../../..")
export const KOBE_DIR: string = join(REPO_ROOT, "packages", "kobe")
export const HERO_CLI: string = join(KOBE_DIR, "dist", "cli", "rove.js")

export const HERO_PORT_BASE = Number.parseInt(process.env.HERO_PORT_BASE ?? "5323", 10)
const PORTS: FixturePorts = fixturePortBase(HERO_PORT_BASE)
export const HERO_WEB_PORT = PORTS.webPort!
export const HERO_PTY_PORT = PORTS.ptyPort!

/** `HERO_ROOT` relocates the fixture — its paths are on camera (engine banners,
 *  folder-trust prompts), and the default one carries the operator's home. */
export const HERO_ROOT: string = process.env.HERO_ROOT ? resolve(process.env.HERO_ROOT) : join(REPO_ROOT, ".scratch", "hero")
const PATHS: FixturePaths = fixturePaths(HERO_ROOT, "orbit-sdk")
export const HERO_HOME: string = PATHS.home
/** Settings blob path derives from the Rove home, not from `XDG_CONFIG_HOME`. */
export const HERO_CONFIG: string = PATHS.configDir
export const HERO_DAEMON_SOCKET: string = PATHS.daemonSocket
export const HERO_PTY_SOCKET: string = PATHS.ptySocket
/** Repo directory name is visible in the sidebar -- keep it product-plausible. */
export const HERO_REPO: string = PATHS.repo

/** Re-exported for callers that already used the hero-specific tripwire name. */
export const assertHeroIsolation = (): void => assertFixtureIsolation(HERO_HOME, HERO_ROOT)

/**
 * The tier classifier's key, for a capture that exercises auto routing.
 *
 * Same bargain `HOME` already strikes above, for the same reason. Rove's own
 * state is isolated, so `secretsPath()` resolves inside the throwaway home and
 * the operator's stored key is invisible to the fixture — which would make a
 * routing capture film `no key` instead of a routed fanout. The environment
 * is the other place the product reads a key from (`docs/CONFIGURATION.md`:
 * the variable wins over the stored file), so that is the channel used here.
 *
 * Read at run time from the operator's own `~/.rove/secrets.json` and passed
 * through the env only. It is never written to the fixture, never put on a
 * command line where `ps` would show it, and `hero-capture.ts`'s
 * `forbidLiteral` guard aborts any take that renders it. Absent is fine:
 * captures that do not touch the classifier neither need nor see it.
 */
function classifierKeyEnv(parent: NodeJS.ProcessEnv): Record<string, string> {
  const name = "TYPESAFE_API_KEY"
  const exported = parent[name]?.trim()
  if (exported) return { [name]: exported }
  try {
    const stored = JSON.parse(readFileSync(join(homedir(), ".rove", "secrets.json"), "utf8")) as Record<string, unknown>
    const value = stored[name]
    return typeof value === "string" && value.trim() ? { [name]: value.trim() } : {}
  } catch {
    return {}
  }
}

/**
 * The fixture's own shell configuration: a `ZDOTDIR` whose `.zshrc` sets a
 * plain prompt, and a `bin/rove` that runs THIS branch's build.
 *
 * `HOME` stays the operator's (above), and the PTY host starts every tab as a
 * login `$SHELL` — so without this, a shell pane in a capture renders the
 * operator's prompt, which on a configured machine carries their account
 * (starship's cloud module prints the signed-in e-mail). `hero-capture.ts`
 * refuses to encode a take that shows one, which is right, and which made
 * the one surface that can show a CLI's output unusable on camera. Pointing
 * `ZDOTDIR` here swaps the operator's zsh startup files for the fixture's
 * without touching `HOME`, so engines still find their credentials.
 *
 * The shim exists because `rove` on the operator's PATH is whatever they have
 * INSTALLED, not the code under capture. It is prepended in `.zshrc` rather
 * than in the environment: macOS's `/etc/zprofile` runs `path_helper`, which
 * would reorder an env-level prefix behind the system paths.
 */
export const CAPTURE_SHELL_DIR: string = join(HERO_ROOT, "shell")

export function ensureCaptureShell(): void {
  const bin = join(CAPTURE_SHELL_DIR, "bin")
  mkdirSync(bin, { recursive: true })
  const write = (path: string, body: string, mode?: number) => {
    let current: string | undefined
    try {
      current = readFileSync(path, "utf8")
    } catch {
      current = undefined
    }
    if (current !== body) writeFileSync(path, body, "utf8")
    if (mode !== undefined) chmodSync(path, mode)
  }
  write(
    join(CAPTURE_SHELL_DIR, ".zshrc"),
    [
      "# Written by packages/kobe-harness/e2e/hero-env.ts — the capture shell is the",
      "# fixture's, not the operator's. See ensureCaptureShell() for why.",
      "PROMPT='%F{8}%1~%f $ '",
      "RPROMPT=''",
      `path=(${JSON.stringify(bin)} $path)`,
      "",
    ].join("\n"),
  )
  write(
    join(bin, "rove"),
    ["#!/bin/sh", "# Written by hero-env.ts: `rove` in a capture shell is this branch's build.", `exec bun ${JSON.stringify(HERO_CLI)} "$@"`, ""].join("\n"),
    0o755,
  )
}

export function heroEnv(parent: NodeJS.ProcessEnv = process.env): Record<string, string> {
  assertHeroIsolation()
  return buildFixtureEnv({
    root: HERO_ROOT,
    home: HERO_HOME,
    ports: PORTS,
    homePolicy: "keep",
    parentEnv: parent,
    extra: { ...classifierKeyEnv(parent), ZDOTDIR: CAPTURE_SHELL_DIR },
  })
}

/**
 * `sh -lc` string the PTY sidecar runs as the harness TUI. A login shell
 * re-reads the operator's rc files, so every isolation variable is re-stated
 * inline rather than trusted to survive the hop.
 */
export function heroPtyCommand(): string {
  const inline = [
    `ROVE_HOME_DIR=${HERO_HOME}`,
    `KOBE_HOME_DIR=${HERO_HOME}`,
    `ROVE_SANDBOX_HOME_DIR=${HERO_HOME}`,
    `KOBE_SANDBOX_HOME_DIR=${HERO_HOME}`,
    `ROVE_DAEMON_SOCKET_PATH=${HERO_DAEMON_SOCKET}`,
    `KOBE_DAEMON_SOCKET_PATH=${HERO_DAEMON_SOCKET}`,
    `ROVE_PTY_SOCKET_PATH=${HERO_PTY_SOCKET}`,
    `KOBE_PTY_SOCKET_PATH=${HERO_PTY_SOCKET}`,
    "ROVE_TASK_ID=",
    "KOBE_TASK_ID=",
    "ROVE_TAB_ID=",
    "KOBE_TAB_ID=",
  ]
    // Single-quoted: a Windows path's backslashes are escapes to an unquoted sh word.
    .map((pair) => pair.replace(/=(.+)$/, (_, value: string) => `='${value}'`))
    .join(" ")
  return `unset ${CLAUDE_MARKERS.join(" ")}; ${inline} bun run dev:sandbox`
}
