/**
 * Neutral `~` (home directory) expansion for CLI path arguments.
 *
 * Shells expand a leading `~` before a program ever sees it, but only for
 * *unquoted* words — `kobe add "~/repo"`, a `~` typed into a prompt, or a
 * path forwarded from another tool all reach us verbatim. `resolve()`
 * treats that `~` as an ordinary path segment, so `resolve(cwd, "~/repo")`
 * yields `<cwd>/~/repo` — a bogus directory that fails every downstream
 * git / fs check. Expand it first, then let the caller resolve relative
 * paths against `$PWD` as usual.
 *
 * `homeDir()` (not `os.homedir()`) so this honours `KOBE_HOME_DIR`, matching
 * `normalizeWorktreeBase` and keeping tests isolated to a tmp home. Only a
 * bare `~` and `~/…` are expanded — `~user/` lookups are rare and left
 * untouched, same as the TUI's `expandHome`.
 */
import { homedir as osHomedir } from "node:os"
import { join } from "node:path"
import { homeDir } from "../env.ts"

/**
 * The display inverse of {@link expandTilde}: `/Users/me/x` → `~/x`. The home
 * prefix repeats on every row of any path list, so it is pure width. Uses the
 * REAL home (not `homeDir()`): what is shown must match what the user's own
 * shell would print, even under an isolated `KOBE_HOME_DIR`.
 */
export function tildify(path: string, home = osHomedir()): string {
  return home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path
}

export function expandTilde(path: string): string {
  if (path === "~") return homeDir()
  if (path.startsWith("~/")) return join(homeDir(), path.slice(2))
  return path
}
