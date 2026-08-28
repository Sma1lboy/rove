/**
 * Isolated environment for the README/docs capture stack ("hero" fixture).
 *
 * Same ground-truth path as `visual:serve` (fixed browser `/harness` →
 * xterm.js → PTY sidecar → real OpenTUI), but pointed at a RICHER throwaway
 * home: a realistic repo, several tasks, and REAL engine sessions, because
 * the barren visual fixture photographs as an empty workspace.
 *
 * One deliberate difference from `visual-fixture.ts`: `HOME` stays the
 * operator's own. The engine under capture is the real `claude` binary and it
 * reads its credentials from `$HOME/.claude`; a redirected home would
 * photograph a login screen. Rove's OWN state is still fully isolated —
 * `ROVE_HOME_DIR` (tasks, worktrees, daemon socket) and `XDG_CONFIG_HOME`
 * (settings) both land under `.scratch/hero/`, and every inherited
 * daemon/task override is scrubbed so a capture run from inside a Rove task
 * can never reach the owner's live daemon.
 */

import { readlinkSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

/** Pre-rename runtime dir; `compat-link.ts` still writes symlinks here. */
const COMPAT_STATE_DIR = ".kobe"

const REPO_ROOT = resolve(import.meta.dirname, "../../..")
export const KOBE_DIR: string = join(REPO_ROOT, "packages", "kobe")
export const HERO_CLI: string = join(KOBE_DIR, "dist", "cli", "rove.js")

export const HERO_PORT_BASE = Number.parseInt(process.env.HERO_PORT_BASE ?? "5323", 10)
export const HERO_WEB_PORT = HERO_PORT_BASE
export const HERO_DAEMON_PORT = HERO_PORT_BASE + 1
export const HERO_PTY_PORT = HERO_PORT_BASE + 2

export const HERO_ROOT: string = join(REPO_ROOT, ".scratch", "hero")
export const HERO_HOME: string = join(HERO_ROOT, "home")
/** Settings blob path derives from the Rove home, not from `XDG_CONFIG_HOME`. */
export const HERO_CONFIG: string = join(HERO_HOME, ".config")
/**
 * The hero daemon's socket, PINNED rather than derived.
 *
 * Deriving it from the home dir is not enough. `.kobe/` is the pre-rename
 * runtime dir, and every daemon bind drops a compatibility symlink there
 * (`compat-link.ts`) so binaries older than the `.kobe` → `.rove` move still
 * find a live daemon. A daemon that binds while `*_HOME_DIR` points at the
 * hero fixture therefore leaves `<hero>/.kobe/daemon.sock` behind — and if
 * that daemon was the OPERATOR's, the link points at the operator's socket.
 * `runtimePath()` prefers an existing legacy path over the canonical one, so
 * from then on every hero process silently attaches to the real daemon.
 *
 * Pinning the socket makes the isolation independent of what is on disk:
 * `defaultDaemonSocketPath()` returns the override before it looks at any
 * path at all. `heroPtyCommand()` already blanked these for the TUI; the
 * shell-side callers need the same, which is what this constant is for.
 */
export const HERO_DAEMON_SOCKET: string = join(HERO_HOME, ".rove", "daemon.sock")
export const HERO_PTY_SOCKET: string = join(HERO_HOME, ".rove", "pty.sock")
/** Repo directory name is visible in the sidebar — keep it product-plausible. */
export const HERO_REPO: string = join(HERO_ROOT, "orbit-sdk")

/** Inherited names that would drag the capture onto the operator's daemon. */
const SCRUBBED = [
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
] as const

/**
 * Claude Code marks its own child processes (`CLAUDECODE`,
 * `CLAUDE_CODE_CHILD_SESSION`, …). A capture driven from inside a Rove task —
 * i.e. from inside Claude Code — leaks those markers down to the engine under
 * capture, which then boots with "Transcript saving is off" and writes no
 * session file at all. The engine-owned history the chat pane renders comes
 * from that file, so the photographed workspace degrades to a raw terminal.
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

function scrubbed(parent: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(parent)) {
    if (value === undefined) continue
    if (CLAUDE_MARKERS.includes(key)) continue
    const suffix = key.startsWith("KOBE_") ? key.slice(5) : key.startsWith("ROVE_") ? key.slice(5) : null
    if (suffix !== null && (SCRUBBED as readonly string[]).includes(suffix)) continue
    out[key] = value
  }
  return out
}

/** Both namespaces, so no compatibility alias can outrank the isolation. */
function stamp(env: Record<string, string>, suffix: string, value: string): void {
  env[`KOBE_${suffix}`] = value
  env[`ROVE_${suffix}`] = value
}

/**
 * Fail loudly if anything under the hero home points OUTSIDE it.
 *
 * The compatibility symlink under `<hero>/.kobe/` is written by whichever
 * daemon binds while `*_HOME_DIR` names the hero fixture — including the
 * operator's own, if a stray shell command ever exports the home without the
 * socket. The result is a link that looks like isolation and is not, and a
 * capture run that quietly drives the real daemon. Pinned sockets make that
 * link inert, so this is a tripwire for the state itself, not the connection.
 */
export function assertHeroIsolation(): void {
  const legacy = join(HERO_HOME, COMPAT_STATE_DIR, "daemon.sock")
  let target: string
  try {
    target = readlinkSync(legacy)
  } catch {
    return // no link, or a real socket the guard in `compat-link.ts` respects
  }
  const resolved = resolve(dirname(legacy), target)
  if (!resolved.startsWith(HERO_ROOT)) {
    throw new Error(
      `hero isolation breach: ${legacy} → ${resolved} (outside ${HERO_ROOT}). ` +
        `Some process bound a daemon while *_HOME_DIR named the hero fixture but the socket did not. ` +
        `Remove that link and re-run; every hero caller must go through heroEnv().`,
    )
  }
}

export function heroEnv(parent: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env = scrubbed(parent)
  env.TERM = "xterm-256color"
  env.COLORTERM = "truecolor"
  stamp(env, "HOME_DIR", HERO_HOME)
  stamp(env, "SANDBOX_HOME_DIR", HERO_HOME)
  stamp(env, "DAEMON_WEB_PORT", String(HERO_DAEMON_PORT))
  stamp(env, "SANDBOX_DAEMON_WEB_PORT", String(HERO_DAEMON_PORT))
  // Pinned, not derived — see HERO_DAEMON_SOCKET. `scrubbed()` dropped any
  // inherited value; these put the hero's OWN path back, so no compatibility
  // symlink under `<hero>/.kobe/` can redirect a hero process elsewhere.
  stamp(env, "DAEMON_SOCKET_PATH", HERO_DAEMON_SOCKET)
  stamp(env, "PTY_SOCKET_PATH", HERO_PTY_SOCKET)
  return env
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
