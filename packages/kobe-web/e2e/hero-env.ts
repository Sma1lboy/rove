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

import { join, resolve } from "node:path"
import {
  assertFixtureIsolation,
  buildFixtureEnv,
  CLAUDE_MARKERS,
  fixturePaths,
  fixturePortBase,
  type FixturePaths,
  type FixturePorts,
} from "../../kobe/scripts/fixture-core.ts"

const REPO_ROOT = resolve(import.meta.dirname, "../../..")
export const KOBE_DIR: string = join(REPO_ROOT, "packages", "kobe")
export const HERO_CLI: string = join(KOBE_DIR, "dist", "cli", "rove.js")

export const HERO_PORT_BASE = Number.parseInt(process.env.HERO_PORT_BASE ?? "5323", 10)
const PORTS: FixturePorts = fixturePortBase(HERO_PORT_BASE)
export const HERO_WEB_PORT = PORTS.webPort!
export const HERO_DAEMON_PORT = PORTS.daemonWebPort
export const HERO_PTY_PORT = PORTS.ptyPort!

export const HERO_ROOT: string = join(REPO_ROOT, ".scratch", "hero")
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

export function heroEnv(parent: NodeJS.ProcessEnv = process.env): Record<string, string> {
  assertHeroIsolation()
  return buildFixtureEnv({
    root: HERO_ROOT,
    home: HERO_HOME,
    ports: PORTS,
    homePolicy: "keep",
    parentEnv: parent,
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
    `ROVE_DAEMON_WEB_PORT=${HERO_DAEMON_PORT}`,
    `KOBE_DAEMON_WEB_PORT=${HERO_DAEMON_PORT}`,
    `ROVE_SANDBOX_DAEMON_WEB_PORT=${HERO_DAEMON_PORT}`,
    `KOBE_SANDBOX_DAEMON_WEB_PORT=${HERO_DAEMON_PORT}`,
    `ROVE_DAEMON_SOCKET_PATH=${HERO_DAEMON_SOCKET}`,
    `KOBE_DAEMON_SOCKET_PATH=${HERO_DAEMON_SOCKET}`,
    `ROVE_PTY_SOCKET_PATH=${HERO_PTY_SOCKET}`,
    `KOBE_PTY_SOCKET_PATH=${HERO_PTY_SOCKET}`,
    "ROVE_TASK_ID=",
    "KOBE_TASK_ID=",
    "ROVE_TAB_ID=",
    "KOBE_TAB_ID=",
  ].join(" ")
  return `unset ${CLAUDE_MARKERS.join(" ")}; ${inline} bun run dev:sandbox`
}
