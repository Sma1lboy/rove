import { deleteRoveEnv, readRoveEnv, setRoveEnv } from "@sma1lboy/kobe-daemon/compat-env"

export type SandboxMode = "run" | "reset" | "home" | "smoketest"
export type SandboxArgs = {
  readonly mode: SandboxMode
  /** Named sandbox instance (`--name x`): own home/daemon/registry/port. */
  readonly name?: string
  /** `run` only: rove argv to exec instead of the TUI (`run api list`). */
  readonly roveArgs: readonly string[]
}

/** The default (unnamed) sandbox daemon's web port — never production's 45174. */
export const SANDBOX_DAEMON_WEB_PORT = "5274"

/** Named instances hash into this range so parallel sandboxes never collide. */
const NAMED_PORT_BASE = 5300
const NAMED_PORT_SPAN = 700

const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/

/**
 * Ambient path overrides the sandbox must DROP rather than inherit.
 *
 * `defaultDaemonSocketPath()` / `defaultPtyHostSocketPath()` give an explicit
 * `*_SOCKET_PATH` override priority OVER `*_HOME_DIR`. The TUI stamps the
 * production socket onto its own env (`tui-react/workspace/host.tsx`), and
 * every task terminal it spawns inherits it — so a `dev:sandbox` launched from
 * inside a kobe task terminal used to bind the PRODUCTION socket while serving
 * its own empty task index. Attached TUIs then reconnected onto the sandbox
 * daemon and rendered "No active tasks" with every task still on disk
 * (prod 2026-08-13). Stamping HOME_DIR is not enough; the override has to go.
 */
const INHERITED_PATH_OVERRIDES = ["DAEMON_SOCKET_PATH", "DAEMON_PID_PATH", "PTY_SOCKET_PATH", "PTY_PID_PATH"] as const

function isSandboxMode(value: string | undefined): value is SandboxMode {
  return value === "run" || value === "reset" || value === "home" || value === "smoketest"
}

/**
 * `[--name <x>] [mode] [rove argv…]`. Extra argv is accepted for `run` only
 * and becomes the rove command to exec in the sandbox env (`run plugin link
 * <dir>`, `run api list`); with none, `run` starts the TUI as before.
 */
export function parseSandboxArgs(args: readonly string[]): SandboxArgs {
  const rest = [...args]
  let name: string | undefined
  if (rest[0] === "--name") {
    name = rest[1]
    if (!name || !NAME_RE.test(name)) throw new Error("--name needs a lowercase [a-z0-9._-] instance name")
    rest.splice(0, 2)
  }
  const first = rest[0]
  if (first !== undefined && !isSandboxMode(first)) throw new Error(`unknown sandbox mode "${first}"`)
  const mode = first ?? "run"
  const roveArgs = rest.slice(1)
  if (roveArgs.length > 0 && mode !== "run") throw new Error(`unexpected argument "${roveArgs[0]}"`)
  return { mode, ...(name ? { name } : {}), roveArgs }
}

/** Deterministic per-name web port — parallel named sandboxes don't collide. */
export function sandboxPortForName(name: string): string {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return String(NAMED_PORT_BASE + (h % NAMED_PORT_SPAN))
}

/** Build a child environment whose sandbox invariants beat ambient aliases. */
export function sandboxChildEnv(
  home: string,
  parent: NodeJS.ProcessEnv = process.env,
  name?: string,
): NodeJS.ProcessEnv {
  const env = { ...parent }
  // Drop inherited production paths BEFORE stamping our own, so nothing an
  // ambient value could outrank survives into the child.
  for (const suffix of INHERITED_PATH_OVERRIDES) deleteRoveEnv(suffix, env)
  // The web port is sandbox-scoped too: read it from the SANDBOX_* namespace
  // (like SANDBOX_HOME_DIR) so a developer can still pick a port, while an
  // ambient production `DAEMON_WEB_PORT` — stamped by `kobe web` — cannot
  // drag the sandbox onto production's listener. Named instances derive a
  // stable per-name port instead of sharing the default.
  const webPort =
    readRoveEnv("SANDBOX_DAEMON_WEB_PORT", parent) ?? (name ? sandboxPortForName(name) : SANDBOX_DAEMON_WEB_PORT)
  setRoveEnv("DEV", "1", env)
  setRoveEnv("HOME_DIR", home, env)
  setRoveEnv("DAEMON_WEB_PORT", webPort, env)
  return env
}
