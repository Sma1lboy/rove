type SandboxMode = "run" | "reset" | "home" | "smoketest" | "seed"
export type SandboxArgs = {
  readonly mode: SandboxMode
  /** Named sandbox instance (`--name x`): own home/daemon/registry/port. */
  readonly name?: string
  /** `run` only: rove argv to exec instead of the TUI (`run api list`). */
  readonly roveArgs: readonly string[]
}

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
