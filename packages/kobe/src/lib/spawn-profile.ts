/**
 * Env-gated log of every child process a Rove process spawns.
 *
 * `ROVE_SPAWN_PROFILE=<path>` turns it on and names a file to append JSON
 * lines to, one per spawn. Off (the default) every call is a single boolean
 * test, so the calls can sit in the paths that actually fork.
 *
 * What it answers: WHO is forking, how often, and against which directory.
 * `ps` cannot answer it — a `git` that lives a few milliseconds is caught
 * mid-exec, and macOS reports its argv as `(git)`; sampling a whole burst
 * yields names and no arguments. `git`'s own `trace2` sees every invocation
 * on the machine but records no parent, so on a box running several agents
 * it cannot say which process asked. The call site can, which is why this
 * records a site NAME chosen by the caller rather than a stack trace: a
 * stack through an async poller is a scheduler frame, not the feature that
 * wanted the data.
 *
 * Monkey-patching `node:child_process` was tried first and is a silent
 * no-op: assigning to the module object succeeds under Bun, and a module
 * that did `import { spawnSync }` keeps calling the original. An
 * instrument that reports nothing looks exactly like a quiet system.
 *
 * Writes to a FILE, never stdout — stdout belongs to the renderer.
 */

import { appendFileSync } from "node:fs"

const target = process.env.ROVE_SPAWN_PROFILE
export const spawnProfileOn = Boolean(target)

/**
 * Record one spawn. `site` is a stable dotted name for the code that wanted
 * the child (`sidebar.worktreeChanges`, `engine.foregroundWalk`), NOT the
 * binary — two callers of `git status` are the thing this has to tell apart.
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
