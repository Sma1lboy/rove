/**
 * How much disk one checkout takes, and how much of that is gitignored
 * (dependencies, build output) — what `worktree-usage` reports so a user with
 * many parallel tasks sees which worktrees are worth reclaiming. Read-only.
 */

import type { ExecHost } from "../../exec/exec-host.ts"
import { READ_ONLY_GIT_ENV } from "../../lib/git-env.ts"
import { duKb, parseIgnoredPaths } from "./salvage-ignored.ts"

export interface CheckoutUsage {
  readonly exists: boolean
  /** Null when `du` could not measure the directory. */
  readonly bytes: number | null
  /** The `.gitignore`d part of {@link bytes}; null when git could not list it. */
  readonly ignoredBytes: number | null
}

export async function measureCheckout(exec: ExecHost, worktreePath: string): Promise<CheckoutUsage> {
  if (!(await exec.exists(worktreePath))) return { exists: false, bytes: null, ignoredBytes: null }
  return {
    exists: true,
    bytes: await totalBytes(exec, worktreePath),
    ignoredBytes: await ignoredBytes(exec, worktreePath),
  }
}

async function totalBytes(exec: ExecHost, worktreePath: string): Promise<number | null> {
  try {
    const du = await exec.run(["du", "-sk", "--", worktreePath])
    const kb = /^\s*(\d+)/.exec(du.stdout)?.[1]
    // An unreadable subtree makes du exit 1 yet still print a (smaller) total.
    return kb ? Number.parseInt(kb, 10) * 1024 : null
  } catch {
    return null
  }
}

async function ignoredBytes(exec: ExecHost, worktreePath: string): Promise<number | null> {
  try {
    // Lock-free, so it never competes with an engine's commit for the index lock.
    const status = await exec.run(["git", "status", "--porcelain", "-z", "--ignored"], {
      cwd: worktreePath,
      env: READ_ONLY_GIT_ENV,
    })
    if (status.exitCode !== 0) return null
    const paths = parseIgnoredPaths(status.stdout)
    if (paths.length === 0) return 0
    let kb = 0
    for (const size of (await duKb(exec, worktreePath, paths)).values()) kb += size
    return kb * 1024
  } catch {
    return null
  }
}
