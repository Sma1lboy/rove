/**
 * How much disk one checkout takes, and how much of that is gitignored
 * (dependencies, build output) — what `worktree-usage` reports so a user with
 * many parallel tasks sees which worktrees are worth reclaiming. Read-only.
 */

import path from "node:path"
import type { ExecHost } from "../../exec/exec-host.ts"
import { READ_ONLY_GIT_ENV } from "../../lib/git-env.ts"
import { duKb, parseIgnoredPaths } from "./salvage-ignored.ts"

export interface CheckoutUsage {
  readonly exists: boolean | null
  /** Null when `du` could not measure the directory. */
  readonly bytes: number | null
  /** The `.gitignore`d part of {@link bytes}; null when listing or measurement failed. */
  readonly ignoredBytes: number | null
}

export async function measureCheckout(exec: ExecHost, worktreePath: string): Promise<CheckoutUsage> {
  const exists = await checkoutExists(exec, worktreePath)
  if (exists !== true) return { exists, bytes: null, ignoredBytes: null }
  return {
    exists: true,
    bytes: await totalBytes(exec, worktreePath),
    ignoredBytes: await ignoredBytes(exec, worktreePath),
  }
}

async function checkoutExists(exec: ExecHost, worktreePath: string): Promise<boolean | null> {
  try {
    // A negative test is conclusive only when its parent directory is accessible.
    const probe = await exec.run([
      "sh",
      "-c",
      '[ -e "$1" ] && exit 0; [ -d "$2" ] && [ -x "$2" ] && exit 1; exit 2',
      "rove-checkout-exists",
      worktreePath,
      path.posix.dirname(worktreePath),
    ])
    return probe.exitCode === 0 ? true : probe.exitCode === 1 ? false : null
  } catch {
    return null
  }
}

async function totalBytes(exec: ExecHost, worktreePath: string): Promise<number | null> {
  try {
    const du = await exec.run(["du", "-sk", "--", worktreePath])
    if (du.exitCode !== 0) return null
    const kb = /^\s*(\d+)/.exec(du.stdout)?.[1]
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
    // Git can exit successfully after warning that it skipped an unreadable directory.
    if (status.exitCode !== 0 || status.stderr.trim() !== "") return null
    const paths = parseIgnoredPaths(status.stdout)
    if (paths.length === 0) return 0
    let kb = 0
    const sizes = await duKb(exec, worktreePath, paths, { requireSuccess: true })
    for (const p of paths) {
      const size = sizes.get(p)
      if (size === undefined) return null
      kb += size
    }
    return kb * 1024
  } catch {
    return null
  }
}
