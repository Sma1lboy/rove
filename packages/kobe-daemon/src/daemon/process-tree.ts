/**
 * Ending a process and everything descended from it, on the one platform
 * where a signal cannot: Windows.
 *
 * ConPTY has no process groups, and node-pty's own `kill()` reaches only the
 * processes attached to the pseudo console — asynchronously, and without
 * anything that allocated its own console or detached from it. A hosted
 * engine spawns exactly that shape (`shell → engine → helpers`, a dev server
 * the agent started), so ending the shell alone left the rest running with
 * their working directory inside the worktree — and Windows refuses to
 * unlink a directory some process has as its cwd, which is how every task
 * delete left an empty `~/.rove/worktrees/<repo>/<name>` behind with
 * `Permission denied`. `taskkill /T` walks the parent chain from the process
 * table, so it reaches the whole subtree whatever console it holds.
 */

import { execFile } from "node:child_process"

/** Upper bound on one `taskkill` run — it answers in milliseconds; a hung
 *  one must not hold a deletion behind it. */
const TASKKILL_TIMEOUT_MS = 5_000

/**
 * `taskkill /T /F /PID <pid>`. Resolves with one line for the signal log —
 * never rejects, because the child may already be gone and that is the
 * outcome the caller wanted.
 *
 * Only ever called with the pid of a child THIS host spawned and still
 * believes alive: a stale pid can have been reused by an unrelated process,
 * and `/F` does not ask.
 */
export function taskkillProcessTree(pid: number): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      "taskkill",
      ["/T", "/F", "/PID", String(pid)],
      { windowsHide: true, timeout: TASKKILL_TIMEOUT_MS },
      (err, stdout, stderr) => {
        const detail = (stderr || stdout || err?.message || "").trim().replace(/\s+/g, " ")
        resolve(
          err ? `taskkill /T /F /PID ${pid} did not complete: ${detail}` : `taskkill /T /F /PID ${pid}: ${detail}`,
        )
      },
    )
  })
}
