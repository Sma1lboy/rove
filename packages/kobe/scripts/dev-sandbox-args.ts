export type SandboxMode = "run" | "reset" | "home" | "smoketest" | "seed"
export type SandboxArgs = {
  readonly mode: SandboxMode
  /** Named sandbox instance (`--name x`): own home/daemon/registry/port. */
  readonly name?: string
  /** `run` only: rove argv to exec instead of the TUI (`run api list`). */
  readonly roveArgs: readonly string[]
}

/** The default (unnamed) sandbox daemon's web port -- never production's 45174. */
export const SANDBOX_DAEMON_WEB_PORT = "5274"

/** Named instances hash into this range so parallel sandboxes never collide. */
const NAMED_PORT_BASE = 5300
const NAMED_PORT_SPAN = 700

const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/

function isSandboxMode(value: string | undefined): value is SandboxMode {
  return value === "run" || value === "reset" || value === "home" || value === "smoketest" || value === "seed"
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

/** Deterministic per-name web port -- parallel named sandboxes don't collide. */
export function sandboxPortForName(name: string): string {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return String(NAMED_PORT_BASE + (h % NAMED_PORT_SPAN))
}
