/** What `task.land`, `task.landPreflight` and `task.syncBase` answer, single- and multi-repo. */

/**
 * Result of a `task.landPreflight` — the read-only "may this land, and into
 * what" probe. Mirrors the orchestrator's `LandPreflight`. `refusal` set means
 * the land would be refused for that reason; absent means it may proceed.
 */
export interface LandPreflightResult {
  readonly branch: string
  /** The merge destination: the base checkout's current branch. Empty only
   *  under the detached-HEAD refusal, where there is no branch to name. */
  readonly landedOn: string
  /** Commits on `branch` the destination does not have. Absent — never a
   *  fabricated zero — when git could not count them. */
  readonly ahead?: number
  readonly baseDirty?: boolean
  readonly refusal?:
    | "DETACHED_HEAD"
    | "UNREADABLE_BASE"
    | "UNBORN_BASE"
    | "SAME_BRANCH"
    | "MAIN_CHECKOUT_DIRTY"
    | "MISSING_REF"
    | "EMPTY_BRANCH"
    | "EMPTY_BRANCH_DIRTY_WORKTREE"
  /** Uncommitted paths in the task's worktree — only with `EMPTY_BRANCH_DIRTY_WORKTREE`. */
  readonly dirtyFiles?: readonly string[]
  readonly baseDir: string
  /** Multi-repo tasks only: each repo's own probe, in picked order. The top-level fields above are the head repo's. */
  readonly repos?: readonly LandRepoPreflight[]
}

/** Result of a `task.land` — mirrors the orchestrator's `LandResult`. */
export interface LandResult {
  readonly branch: string
  readonly strategy: "merge" | "squash"
  readonly landedOn: string
  readonly commit: string
  /** The post-land worktree cleanup outcome. Present unless removal was
   *  explicitly declined (`removeWorktree: false`). `reason` is not
   *  failure-only: it also rides with `removed: true` when the directory went
   *  but clearing the task's worktree path did not. */
  readonly worktree?: {
    readonly removed: boolean
    readonly reason?: string
    /** Set when git deregistered the worktree but could not delete its
     *  directory — the land and its cleanup both succeeded; a directory is
     *  left on disk that Rove will never list again. */
    readonly residue?: { readonly path: string; readonly reason: string }
  }
  /** Ref anchoring a deleted branch's tip when nothing else reached it (the
   *  squash-land case). Absent on a `--no-ff` merge and when no branch was
   *  deleted. */
  readonly branchAnchor?: { readonly ref: string; readonly commit: string }
  /** Set when `--delete-branch` was asked for and the branch was kept anyway,
   *  because its worktree is still on disk with the branch checked out — git
   *  would refuse the delete. `reason` is why the worktree stayed. */
  readonly branchKept?: { readonly reason: string }
  /** Multi-repo tasks only: every repo's outcome in picked order. The top-level fields above are the primary's. */
  readonly repos?: readonly LandRepoResult[]
  /** Multi-repo tasks only: set when the run stopped before every repo landed; re-running resumes. */
  readonly stopped?: { readonly repo: string; readonly code: string; readonly message: string }
}

/** What one repo of a multi-repo land did (or, from a probe, would do). */
export type LandRepoStatus = "landed" | "skipped" | "conflict" | "refused" | "failed" | "pending"

/** One repo's row of a multi-repo `task.land`. */
export interface LandRepoResult {
  readonly name: string
  readonly status: LandRepoStatus
  readonly branch?: string
  readonly landedOn?: string
  readonly ahead?: number
  readonly commit?: string
  /** Why the repo was skipped, refused or failed, or its conflicted files. */
  readonly error?: string
  /** Refusal or error code (`LAND_CONFLICT`, `MAIN_CHECKOUT_DIRTY`, …). */
  readonly code?: string
  readonly worktree?: LandResult["worktree"]
  readonly branchAnchor?: LandResult["branchAnchor"]
  readonly branchKept?: LandResult["branchKept"]
}

/** One repo's row of a multi-repo `task.landPreflight`. `ready` repos have commits to land and no refusal. */
export interface LandRepoPreflight extends LandPreflightResult {
  readonly name: string
  readonly status: "ready" | "skipped" | "refused"
  readonly message?: string
}

/** One repo's row of a multi-repo `task.syncBase`. */
export interface SyncRepoResult {
  readonly name: string
  readonly ok: boolean
  readonly baseRef?: string
  readonly alreadyCurrent?: boolean
  /** The failure's message, `SYNC_CONFLICT: …` / `SYNC_WORKTREE_DIRTY: …` markers included. */
  readonly error?: string
  /** The marker at the head of `error`, when it has one. */
  readonly code?: string
}

/** Result of `task.syncBase` on a multi-repo task. */
export interface SyncReposResult {
  /** The first synced repo's base. */
  readonly baseRef: string
  /** True only when every repo was already current. */
  readonly alreadyCurrent: boolean
  readonly repos: readonly SyncRepoResult[]
}
