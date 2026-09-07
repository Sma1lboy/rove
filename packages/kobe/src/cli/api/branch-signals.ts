/**
 * Committed-work signals for `collect`: how far a task branch has moved
 * from its base. `readWorktreeChanges` only counts UNCOMMITTED files, so a
 * task that commits its work reads `+0 −0` — exactly when the caller is
 * choosing a fan-out winner. These helpers add the committed side:
 * ahead-of-base and behind-base commit counts, and a diffstat vs the
 * merge-base.
 *
 * The base ref comes from the TASK RECORD first: `add --base-branch` is
 * persisted on the task at create time, so a task cut from `release/2.x`
 * is measured against `release/2.x`, not against a guess. Records that
 * predate the field (or whose recorded ref does not resolve) fall back
 * to {@link resolveBaseRef}. All reads are lock-free
 * (`GIT_OPTIONAL_LOCKS=0`) and best-effort — a repo with no resolvable
 * base yields nulls, never an error.
 */

import { spawnSync } from "node:child_process"
import { DEFAULT_BASE_REF_CANDIDATES } from "@sma1lboy/kobe-daemon/daemon/worktree-probe"
import { readOnlyGitProcessEnv } from "../../lib/git-env.ts"

export interface BranchSignals {
  /** Base ref the signals were computed against; null = none resolvable. */
  readonly baseRef: string | null
  /** `git rev-list --count <base>..HEAD`; null when base is unresolvable. */
  readonly ahead: number | null
  /**
   * `git rev-list --count HEAD..<base>` — how far the branch has DRIFTED
   * behind the base since it forked. The sibling of `ahead`, and the one a
   * long-running attempt needs: a task that has been working for two hours is
   * building against a base that has moved. Null when base is unresolvable.
   */
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
 * Whether `ref` and HEAD have a common ancestor. A ref that resolves is not
 * yet a base: two branches can both exist and share no history at all (an
 * abandoned orphan `main` beside a live `develop` is the shape that produced
 * this check). Measuring against one of those yields a fabricated ahead/behind
 * pair and a null diffstat — `git diff <unrelated>...HEAD` fails outright, and
 * that null was the only tell the numbers beside it were nonsense.
 */
function sharesHistory(worktreePath: string, ref: string): boolean {
  return git(worktreePath, ["merge-base", ref, "HEAD"]) !== null
}

/**
 * The branch the BASE CHECKOUT is on — the same question `land` asks before it
 * merges ({@link landPreflight} reads it from the base repo), reached here
 * from the worktree alone. `git worktree list --porcelain` names the main
 * working tree in its first record, so one read answers both "which checkout
 * is the base" and "what branch is it on". Null when that record has no branch
 * (a detached base checkout) or the read fails.
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
 * The base to measure a task branch against when the task record names none:
 * `origin/HEAD` → `origin/main` → `origin/master` → `main` → `master`, taking
 * the first candidate that BOTH resolves and shares history with HEAD, then
 * falling back to the base checkout's own branch.
 *
 * The history check and the fallback are one fix for one failure: a repo whose
 * real base is `develop` or `trunk` gets either an unrelated ladder hit (a
 * stale `main` nobody has touched in a year) or nothing at all, and `collect`
 * then reports an ahead-count a fan-out coordinator picks winners on. Asking
 * the base checkout is not a sixth guess — it is what `land` already merges
 * into, so the two verbs now answer about the same branch.
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

/**
 * The base to measure against: the task's RECORDED fork point when present
 * and still resolvable, else the {@link resolveBaseRef} guess for records
 * that predate the persisted field. A recorded ref that stops resolving
 * (base branch deleted, remote renamed) falls back too — an honest guess
 * beats a stale certainty.
 */
function resolveMeasureBase(worktreePath: string, recordedBaseRef?: string): string | null {
  if (recordedBaseRef && git(worktreePath, ["rev-parse", "--verify", "--quiet", recordedBaseRef]) !== null) {
    return recordedBaseRef
  }
  return resolveBaseRef(worktreePath)
}

/**
 * Parse `git diff --shortstat` output, e.g.
 * ` 3 files changed, 40 insertions(+), 2 deletions(-)` — any clause may be
 * absent. An empty string is a real result: zero committed changes.
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
