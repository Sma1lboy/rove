/**
 * Committed-work signals for `collect` (ahead/behind counts, diffstat vs the
 * merge-base) — `readWorktreeChanges` counts only UNCOMMITTED files, so a
 * committing task reads `+0 −0`.
 *
 * Base = the task's recorded `--base-branch`, else {@link resolveBaseRef}.
 * Reads are lock-free and best-effort: no resolvable base yields nulls.
 */

import { spawnSync } from "node:child_process"
import { DEFAULT_BASE_REF_CANDIDATES } from "@sma1lboy/kobe-daemon/daemon/worktree-probe"
import { readOnlyGitProcessEnv } from "../../lib/git-env.ts"

export interface BranchSignals {
  /** Base ref the signals were computed against; null = none resolvable. */
  readonly baseRef: string | null
  /** `git rev-list --count <base>..HEAD`; null when base is unresolvable. */
  readonly ahead: number | null
  /** `git rev-list --count HEAD..<base>` — drift since fork; null when base is unresolvable. */
  readonly behind: number | null
  /** Committed diff vs the merge-base (`git diff --shortstat <base>...HEAD`). */
  readonly diff: { files: number; insertions: number; deletions: number } | null
}

const NONE: BranchSignals = { baseRef: null, ahead: null, behind: null, diff: null }

function git(cwd: string, args: readonly string[]): string | null {
  try {
    const out = spawnSync("git", [...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: readOnlyGitProcessEnv(),
    })
    return out.status === 0 ? out.stdout.trim() : null
  } catch {
    return null
  }
}

/**
 * Whether `ref` and HEAD share an ancestor. A resolving ref isn't yet a base:
 * an orphan `main` beside a live `develop` yields fabricated ahead/behind.
 */
function sharesHistory(worktreePath: string, ref: string): boolean {
  return git(worktreePath, ["merge-base", ref, "HEAD"]) !== null
}

/**
 * The BASE CHECKOUT's branch (what `land` merges into), from the first
 * `git worktree list --porcelain` record. Null when detached or unreadable.
 */
function baseCheckoutBranch(worktreePath: string): string | null {
  const out = git(worktreePath, ["worktree", "list", "--porcelain"])
  if (!out) return null
  const first = out.split("\n\n", 1)[0] ?? ""
  const line = first.split("\n").find((l) => l.startsWith("branch "))
  if (!line) return null
  const branch = line
    .slice("branch ".length)
    .trim()
    .replace(/^refs\/heads\//, "")
  return branch || null
}

/**
 * Base when the record names none: `origin/HEAD` → `origin/main` →
 * `origin/master` → `main` → `master`, first that resolves AND shares history,
 * else the base checkout's branch (so `develop`/`trunk` repos measure against
 * what `land` merges into, not a stale `main`).
 */
export function resolveBaseRef(worktreePath: string): string | null {
  const head = git(worktreePath, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])
  for (const guess of [...(head ? [head] : []), ...DEFAULT_BASE_REF_CANDIDATES]) {
    if (git(worktreePath, ["rev-parse", "--verify", "--quiet", guess]) === null) continue
    if (sharesHistory(worktreePath, guess)) return guess
  }
  const base = baseCheckoutBranch(worktreePath)
  return base && sharesHistory(worktreePath, base) ? base : null
}

/** The recorded fork point if it still resolves, else {@link resolveBaseRef}. */
function resolveMeasureBase(worktreePath: string, recordedBaseRef?: string): string | null {
  if (recordedBaseRef && git(worktreePath, ["rev-parse", "--verify", "--quiet", recordedBaseRef]) !== null) {
    return recordedBaseRef
  }
  return resolveBaseRef(worktreePath)
}

/**
 * Parse ` 3 files changed, 40 insertions(+), 2 deletions(-)`; any clause may
 * be absent, and "" is a real result (zero changes).
 */
export function parseShortstat(text: string): { files: number; insertions: number; deletions: number } {
  const num = (re: RegExp): number => {
    const m = text.match(re)
    return m ? Number.parseInt(m[1] ?? "0", 10) : 0
  }
  return {
    files: num(/(\d+) files? changed/),
    insertions: num(/(\d+) insertions?\(\+\)/),
    deletions: num(/(\d+) deletions?\(-\)/),
  }
}

export function readBranchSignals(worktreePath: string, recordedBaseRef?: string): BranchSignals {
  if (!worktreePath) return NONE
  const baseRef = resolveMeasureBase(worktreePath, recordedBaseRef)
  if (!baseRef) return NONE
  const count = (range: string): number | null => {
    const out = git(worktreePath, ["rev-list", "--count", range])
    if (out === null) return null
    const n = Number.parseInt(out, 10)
    return Number.isNaN(n) ? null : n
  }
  const ahead = count(`${baseRef}..HEAD`)
  const behind = count(`HEAD..${baseRef}`)
  // Three-dot: diff from the merge-base, so drift on the base branch since
  // the fork point doesn't pollute the task's own stats.
  const statOut = git(worktreePath, ["diff", "--shortstat", `${baseRef}...HEAD`])
  const diff = statOut === null ? null : parseShortstat(statOut)
  return { baseRef, ahead, behind, diff }
}
