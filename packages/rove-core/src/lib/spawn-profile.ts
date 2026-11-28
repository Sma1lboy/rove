/**
 * Env-gated log of every child process a Rove process spawns.
 *
 * `ROVE_SPAWN_PROFILE=<path>` turns it on and names a file to append JSON
 * lines to, one per spawn. Off (the default) every call is a single boolean
 * test, so the calls can sit in the paths that actually fork.
 *
 * Answers WHO forks, how often, in which directory. `ps` can't: a
 * short-lived `git` shows on macOS as `(git)` with no args. `trace2` records
 * no parent. So the caller names its site; a stack through an async poller
 * is a scheduler frame.
 *
 * Not a `node:child_process` monkey-patch: under Bun that is a silent no-op
 * for modules that did `import { spawnSync }`.
 *
 * Writes to a FILE, never stdout — stdout belongs to the renderer.
 */

import { appendFileSync } from "node:fs"

const target = process.env.ROVE_SPAWN_PROFILE
export const spawnProfileOn = Boolean(target)

/**
 * Record one spawn. `site` is a stable dotted caller name
 * (`engine.foregroundWalk`), NOT the binary: two `git status` callers must
 * be told apart.
 */
export function recordSpawn(site: string, argv: readonly string[], cwd?: string): void {
  if (!spawnProfileOn) return
  try {
    const row = { t: Date.now(), pid: process.pid, site, argv: argv.slice(0, 12), ...(cwd ? { cwd } : {}) }
    appendFileSync(target as string, `${JSON.stringify(row)}\n`)
  } catch {
    /* profiling must never take the process down */
  }
}
