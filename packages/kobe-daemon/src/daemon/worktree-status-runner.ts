import { spawn } from "node:child_process"
import type { WorktreeChanges } from "./contracts.ts"
import { parsePorcelainRows } from "./git-porcelain.ts"

/** One lock-free `git` read in a worktree; null stdout on any non-zero exit. */
function runGit(worktreePath: string, args: readonly string[], signal: AbortSignal): Promise<string | null> {
  return new Promise((resolve) => {
    let stdout = ""
    let settled = false
    const finish = (status: number | null) => {
      if (settled) return
      settled = true
      resolve(status === 0 ? stdout : null)
    }
    const child = spawn("git", args.slice(), {
      cwd: worktreePath,
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      signal,
      killSignal: "SIGKILL",
    })
    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += String(chunk)
    })
    child.on("error", () => finish(null))
    child.on("close", finish)
  })
}

/**
 * How far the worktree has drifted from `baseRef`, both ways, in ONE process.
 * `null` when the ref does not resolve or the counts are unreadable — the
 * chips then do not draw, which is the honest answer for a repo with no base
 * rather than a fabricated zero.
 *
 * The daemon does NOT own the `origin/HEAD → origin/main → main → master`
 * fallback ladder: that lives in kobe's `cli/api/branch-signals.ts`, and the
 * PRODUCTION runner is kobe's `runtime.runWorktreeStatus`, which resolves it
 * before calling in. This default runner (tests, and any daemon wired without
 * a runtime) only measures against a base it was handed.
 */
async function countDrift(worktreePath: string, baseRef: string, signal: AbortSignal): Promise<AheadBehind | null> {
  return parseAheadBehind(
    await runGit(worktreePath, ["rev-list", "--left-right", "--count", `${baseRef}...HEAD`], signal),
  )
}

/** Both halves of one drift measurement. */
export interface AheadBehind {
  readonly behind: number
  readonly ahead: number
}

/**
 * Parse `git rev-list --left-right --count <base>...HEAD`, whose one line is
 * `<behind>\t<ahead>` — left is the base side (commits the base has that we
 * do not), right is ours. `null` for anything that is not two non-negative
 * integers, including the `null` a failed run hands in: a half-read line must
 * leave BOTH numbers absent rather than let one of them be guessed.
 *
 * @public — imported by kobe's production runner (`core/daemon-runtime.ts`) so
 * the two collection paths cannot disagree about what the counts mean.
 */
export function parseAheadBehind(stdout: string | null): AheadBehind | null {
  if (stdout === null) return null
  const parts = stdout.trim().split(/\s+/)
  if (parts.length !== 2) return null
  const behind = Number.parseInt(parts[0] ?? "", 10)
  const ahead = Number.parseInt(parts[1] ?? "", 10)
  if (!Number.isInteger(behind) || behind < 0 || !Number.isInteger(ahead) || ahead < 0) return null
  return { behind, ahead }
}

/** Aggregate `git status --porcelain=v1` output into `+N −M`. */
export function countPorcelain(stdout: string): { added: number; deleted: number } {
  let added = 0
  let deleted = 0
  // Shared parser (`git-porcelain.ts`), not a local re-scan: this counter feeds
  // the sidebar chips while kobe's file tree renders rows from the same bytes,
  // and a second, laxer line filter here counted junk the real parser rejects.
  for (const row of parsePorcelainRows(stdout)) {
    if (row.x === "D" || row.y === "D") deleted++
    else added++
  }
  return { added, deleted }
}

/** The default runner: async `git status --porcelain=v1`, lock-free read,
 *  plus the ahead/behind drift when a base ref was supplied. */
export async function runGitStatus(
  worktreePath: string,
  signal: AbortSignal,
  baseRef?: string,
): Promise<WorktreeChanges> {
  const stdout = await runGit(worktreePath, ["status", "--porcelain=v1"], signal)
  if (stdout === null) throw new Error("git status failed")
  const counts = countPorcelain(stdout)
  if (!baseRef) return counts
  const drift = await countDrift(worktreePath, baseRef, signal)
  return drift === null ? counts : { ...counts, ...drift }
}
