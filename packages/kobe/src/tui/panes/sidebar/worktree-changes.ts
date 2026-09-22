/**
 * Uncommitted-file counts for the sidebar's `+N −M` chip (shown only when
 * dirty): `+N` added/modified/renamed/copied/untracked, `−M` deleted in index
 * or worktree.
 *
 * Never throws, but failure returns `null`, NOT zeros: missing repo, EACCES,
 * git off PATH, vanished worktree all mean "could not read", while `+0 −0` is a
 * real clean worktree. Conflating them makes an unreadable worktree read as
 * safe to land or delete.
 *
 * ⚠️ SYNC — one-shot CLI use ONLY (`kobe api` task queries). `git status` is
 * O(repo size); on a render path it froze the Tasks pane for a 30GB repo's
 * walk every tick. Render paths go through `worktree-changes-poller.ts` (async,
 * deduped, timeout/backoff); only `parsePorcelain` is shared.
 *
 * Not `orchestrator/worktree/manager.ts#isDirty`: that one is async,
 * boolean-only and throws. Pane-side git wrappers are deliberately separate
 * from the orchestrator's stricter ones.
 */

import { spawnSync } from "node:child_process"
import { readOnlyGitProcessEnv } from "@/lib/git-env"
import { parsePorcelainRows } from "@/lib/git-parsers"
import { recordSpawn } from "@/lib/spawn-profile"
import type { WorktreeChanges } from "@sma1lboy/kobe-daemon/daemon/contracts"

export type { WorktreeChanges }

const ZERO: WorktreeChanges = { added: 0, deleted: 0 }

/**
 * Value equality shared by the poller's signal `equals`, the per-row memo and
 * RemoteOrchestrator's pushed-map compare, so "unchanged counts don't
 * re-render rows" (DESIGN §5.5) is one predicate.
 */
export function sameWorktreeChanges(a: WorktreeChanges | null, b: WorktreeChanges | null): boolean {
  if (a === null || b === null) return a === b
  return a.added === b.added && a.deleted === b.deleted && a.behind === b.behind && a.ahead === b.ahead
}

/**
 * Daemon-pushed counts for a row, or `null` when the local poller must serve
 * it. A non-null map means the daemon owns polling: an absent worktree (new
 * task, deleted row, remote project) reads as zeros, NEVER "poll locally" — the
 * fallback is per-connection, not per-row, or panes would re-grow git polls for
 * exactly the rows the daemon skips.
 */
export function pickPushedChanges(
  pushed: ReadonlyMap<string, WorktreeChanges | null> | null | undefined,
  worktreePath: string,
): WorktreeChanges | "unknown" | null {
  if (!pushed) return null
  // Present-with-null = daemon tried and couldn't read; must not collapse into
  // ZERO, or an unreadable worktree reads as clean.
  if (pushed.has(worktreePath)) return pushed.get(worktreePath) ?? "unknown"
  return ZERO
}

/**
 * Never throws; `null` (empty path, non-zero exit, spawn threw) means unknown
 * and must never be rendered as clean.
 */
export function readWorktreeChanges(worktreePath: string): WorktreeChanges | null {
  if (!worktreePath) return null
  try {
    recordSpawn("sidebar.worktreeChangesSync", ["git", "status", "--porcelain=v1"], worktreePath)
    const out = spawnSync("git", ["status", "--porcelain=v1"], {
      cwd: worktreePath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      // `git status` may refresh `.git/index` and take `.git/index.lock`,
      // racing engine commits on a 2s-per-row poll. `GIT_OPTIONAL_LOCKS=0`
      // keeps it read-only.
      env: readOnlyGitProcessEnv(),
    })
    if (out.status !== 0 || out.stdout === undefined || out.stdout === null) return null
    return parsePorcelain(out.stdout)
  } catch {
    return null
  }
}

/**
 * Porcelain → `+N −M`. Parsing is {@link parsePorcelainRows}'s; this only
 * classifies the raw `x`/`y` pair: a `D` in EITHER column is a deletion,
 * everything else (M, A, R, C, T, U, ??) an addition. A rename is one row, one
 * `added`. Exported for tests.
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
