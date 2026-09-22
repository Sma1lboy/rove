/**
 * `~` expansion for CLI path arguments. Quoted `~` (`kobe add "~/repo"`, prompt
 * input, forwarded paths) arrives verbatim, and `resolve(cwd, "~/repo")` yields
 * a bogus `<cwd>/~/repo`.
 *
 * Uses `homeDir()` so `KOBE_HOME_DIR` is honoured. Only `~` and `~/…`;
 * `~user/` is left untouched.
 */
import { homedir as osHomedir } from "node:os"
import { join } from "node:path"
import { pathWithin } from "@sma1lboy/kobe-daemon/path-identity"
import { homeDir } from "../env.ts"

/** Display inverse of {@link expandTilde}. Uses the REAL home, not `homeDir()`,
 *  so it matches what the user's shell would print under `KOBE_HOME_DIR`. */
export function tildify(path: string, home = osHomedir()): string {
  const suffix = pathWithin(home, path)
  return suffix === null ? path : suffix ? `~/${suffix}` : "~"
}

export function expandTilde(path: string): string {
  if (path === "~") return homeDir()
  if (path.startsWith("~/") || (process.platform === "win32" && path.startsWith("~\\")))
    return join(homeDir(), path.slice(2))
  return path
}
