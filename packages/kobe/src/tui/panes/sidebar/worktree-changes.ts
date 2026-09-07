/**
 * Tiny worktree-changes helper for the sidebar's per-row `+N −M` chip.
 *
 * Each task row renders a status badge + title; this helper feeds the
 * right-edge "uncommitted file counts" chip:
 *
 *   `+N` — files added, modified, renamed, copied, or untracked
 *   `−M` — files deleted (in index or worktree)
 *
 * Shows up next to the task title only when the worktree is dirty —
 * a clean tracked branch contributes nothing, so the row reads as it
 * always has.
 *
 * Implementation: a single synchronous `git status --porcelain=v1`
 * call, classified per row (any `D` in either column → `−`, anything
 * else → `+`). Never throws — the sidebar must always render — but a
 * failure returns `null`, NOT zeros: a missing repo, an EACCES, git off
 * PATH or a vanished worktree all mean "could not read", and `+0 −0` is
 * the legitimate answer for a genuinely clean worktree. Rendering the two
 * the same is how a coordinator reads an unreadable worktree as safe to
 * land and a user reads it as safe to delete.
 *
 * ⚠️ SYNC — one-shot CLI use ONLY (`kobe api` task queries). `git
 * status` is O(repo size); calling this from a render path froze the
 * Tasks pane for the lifetime of a 30GB repo's status walk, every
 * tick. The sidebar reads through `worktree-changes-poller.ts` (async
 * spawn + in-flight dedupe + timeout/backoff) instead — new render-
 * path consumers must too. Only `parsePorcelain` is shared.
 *
 * Why a separate file rather than reaching into
 * `src/orchestrator/worktree/manager.ts#isDirty`: that one is `async`,
 * boolean-only, and throws. The sidebar is sync, needs counts, and
 * tolerates every failure mode. Same trade-off `git-head.ts` and
 * `src/tui/panes/filetree/git.ts` made — pane-side git wrappers are
 * intentionally separate from the orchestrator's stricter ones.
 */

import { spawnSync } from "node:child_process"
import { readOnlyGitProcessEnv } from "@/lib/git-env"
import { parsePorcelainRows } from "@/lib/git-parsers"

export interface WorktreeChanges {
  /** Files added, modified, renamed, copied, or untracked. */
  readonly added: number
  /** Files deleted (in index or worktree). */
  readonly deleted: number
  /**
   * Commits this worktree is BEHIND its base (`git rev-list --count
   * HEAD..<base>`), from the daemon's collector. Absent when no base ref
   * resolves, or when the counts came from the local sync fallback — which
   * only reads `git status` and therefore knows nothing about the base.
   */
  readonly behind?: number
  /**
   * Commits this worktree has that its base does NOT, from the same
   * `--left-right` read that produced `behind`. Absent under exactly the same
   * conditions. It is the only chip that survives a commit: committing empties
   * `added`/`deleted`, so without it a worker that shipped and one that
   * shipped nothing render identically.
   */
  readonly ahead?: number
}

const ZERO: WorktreeChanges = { added: 0, deleted: 0 }

/**
 * Value equality for change counts — shared by the local poller's signal
 * `equals`, the sidebar's per-row memo, and the RemoteOrchestrator's
 * pushed-map comparison, so "unchanged counts don't re-render rows"
 * (DESIGN §5.5) is one predicate everywhere.
 */
export function sameWorktreeChanges(a: WorktreeChanges | null, b: WorktreeChanges | null): boolean {
  if (a === null || b === null) return a === b
  return a.added === b.added && a.deleted === b.deleted && a.behind === b.behind && a.ahead === b.ahead
}

/**
 * Pick the DAEMON-pushed counts for a row, or `null` when the local
 * poller must serve it. A non-null `pushed` map means a
 * daemon-side collector owns git polling for this process — a worktree
 * absent from the map (just-created task, deleted row, remote project)
 * reads as zeros (chip hidden), NEVER as "poll locally": the fallback is
 * per-connection, not per-row, or every pane would re-grow git polls for
 * exactly the rows the daemon deliberately skips. Pure — unit-tested.
 */
export function pickPushedChanges(
  pushed: ReadonlyMap<string, WorktreeChanges | null> | null | undefined,
  worktreePath: string,
): WorktreeChanges | "unknown" | null {
  if (!pushed) return null
  // PRESENT-with-null is the daemon saying it tried and could not read. That
  // is not the same as an absent key, and it must not collapse into ZERO — the
  // hidden chip is what let an unreadable worktree read as clean.
  if (pushed.has(worktreePath)) return pushed.get(worktreePath) ?? "unknown"
  return ZERO
}

/**
 * Read worktree change counts for `worktreePath`. Never throws; returns
 * `null` when the counts could not be read at all — an empty path, a
 * non-zero `git status`, or a spawn that threw. `null` is NOT `{0,0}`:
 * callers must render/report it as unknown, never as clean.
 */
export function readWorktreeChanges(worktreePath: string): WorktreeChanges | null {
  if (!worktreePath) return null
  try {
    const out = spawnSync("git", ["status", "--porcelain=v1"], {
      cwd: worktreePath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      // `git status` opportunistically rewrites `.git/index` (refreshed
      // stat cache), which takes `.git/index.lock`. This runs on a 2s
      // poll for every row, so it would race the worktree's engine
      // commits and other panes for the lock. `GIT_OPTIONAL_LOCKS=0`
      // makes this read-only: inspect, don't write, never take the lock.
      env: readOnlyGitProcessEnv(),
    })
    if (out.status !== 0 || out.stdout === undefined || out.stdout === null) return null
    return parsePorcelain(out.stdout)
  } catch {
    return null
  }
}

/**
 * Aggregate porcelain output into `+N −M` counts. Exported for unit tests.
 *
 * Parsing (the `XY <path>` shape, branch-header skip, C-string unquoting,
 * rename resolution) is delegated to the shared {@link parsePorcelainRows};
 * this helper only classifies each row by its raw status pair: a `D` in
 * EITHER column counts as a deletion, everything else (M, A, R, C, T, U, ??)
 * as an addition. A rename is one porcelain row → one `added` event; the
 * shared parser preserves the raw `x`/`y` chars so this
 * classification stays exact.
 */
export function parsePorcelain(text: string): WorktreeChanges {
  let added = 0
  let deleted = 0
  for (const { x, y } of parsePorcelainRows(text)) {
    if (x === "D" || y === "D") deleted += 1
    else added += 1
  }
  return { added, deleted }
}
