/**
 * Worktree manager: kobe's wrapper around `git worktree` (DESIGN.md §5.3,
 * §11.3). New Rove-created worktrees use `~/.rove/worktrees/<repo-key>/<slug>/`;
 * `.kobe/worktrees` (global/repo-local) and `.claude/worktrees` task paths
 * remain supported. The orchestrator must never shell out to `git worktree`
 * directly, so error handling, dirty detection, and path conventions live in
 * one place.
 */

import type { AdoptableWorktree } from "@sma1lboy/kobe-daemon/daemon/contracts"
import type { WorktreeVerdict, WorktreeVerdictReason } from "../orchestrator/worktree/staleness"

export type { AdoptableWorktree }

/**
 * Snapshot of a worktree on disk. `path` is absolute; `head` is the commit SHA;
 * `dirty` is true iff `git status --porcelain` lists entries (untracked or
 * modified), and `null` when that probe failed (unreadable `.git`, worktree
 * gone mid-probe). `null` is not `false`: a user reads "clean" before deleting.
 */
export interface WorktreeInfo {
  readonly path: string
  readonly branch: string
  readonly head: string
  readonly dirty: boolean | null
}

/**
 * One row of the cross-project worktree audit (`worktree.list` RPC). Extends
 * {@link AdoptableWorktree} (every worktree of a repo, kobe-managed or not).
 * Local projects only.
 */
export interface WorktreeAuditRow extends AdoptableWorktree {
  readonly repo: string
  /** Worktree directory's creation time (epoch ms), 0 when unreadable —
   *  distinct from {@link AdoptableWorktree.lastActivityMs} (last commit). */
  readonly createdAtMs: number
  /** Whether `branch` exists on `origin`. `null` = no origin / unreachable /
   *  timed out — rendered as "unknown", never a delete-blocker. */
  readonly branchOnRemote: boolean | null
  /** Staleness rubric result (`orchestrator/worktree/staleness.ts`):
   *  dirty > PR open > PR merged > 0-ahead-of-main > PR closed > idle age.
   *  Advisory badge only — never a delete-gate. */
  readonly verdict: WorktreeVerdict
  /** WHY the verdict fired — i18n suffix under `worktrees.verdict.*`. */
  readonly verdictReason: WorktreeVerdictReason
}

/** One local project's worktree audit rows (`worktree.list` response shape). */
export interface WorktreeProject {
  readonly repo: string
  readonly worktrees: readonly WorktreeAuditRow[]
}

/**
 * Manager for git worktrees mapped 1:1 to kobe Tasks.
 *
 * Conventions / invariants the impl must hold:
 * - `create()` is responsible for creating the branch if it doesn't
 *   exist. If the branch exists and points elsewhere, `create()` must
 *   reject — never silently fast-forward or hijack a branch.
 * - `remove()` refuses to remove a dirty worktree unless `force=true`.
 *   This is the single most important safety property here.
 * - `list()` enumerates ONLY worktrees managed by kobe (i.e. under the
 *   kobe worktree root convention), not all worktrees on the repo.
 * - All paths in/out are absolute. No tilde expansion, no relative
 *   paths — caller normalizes before calling.
 * - All git invocations use argv arrays, never shell strings. No
 *   string concatenation into a shell.
 */
export interface WorktreeManager {
  /**
   * Create a worktree at `path` for `branch` rooted in `repo`.
   *
   * Guarantees: on success, `path` exists, contains a checked-out
   * working tree on `branch`, and is registered in the repo's
   * worktree list. On failure, no partial state is left behind
   * (best-effort cleanup before throwing).
   *
   * `baseRef`: root a NEW branch at this ref (anything `git worktree add -b
   * <new> <path> <baseRef>` accepts); undefined roots it at the repo's HEAD.
   * Ignored when the branch already exists; never silently fast-forwards.
   */
  create(repo: string, branch: string, path: string, baseRef?: string): Promise<WorktreeInfo>

  /**
   * Remove a worktree created with {@link create}.
   *
   * Guarantees: refuses to remove a dirty worktree unless `force` is
   * true. On success, the directory is gone, the worktree is
   * deregistered from the repo, and the branch is left in place.
   */
  remove(path: string, opts?: { readonly force?: boolean }): Promise<void>

  /**
   * List all kobe-managed worktrees under `repo`.
   *
   * Guarantees: only worktrees inside the kobe convention root (DESIGN.md
   * §11.3); stable across calls when the filesystem is unchanged.
   */
  list(repo: string): Promise<readonly WorktreeInfo[]>

  /**
   * Whether a worktree has uncommitted or untracked changes.
   *
   * Guarantees: equivalent to `git -C <path> status --porcelain` being
   * non-empty. Submodules are intentionally NOT recursed (matches git
   * default).
   */
  isDirty(path: string): Promise<boolean>

  /**
   * The branch currently checked out at `path`.
   *
   * Guarantees: returns the short branch name (no `refs/heads/`
   * prefix). Throws if `path` is detached HEAD or not a worktree.
   */
  currentBranch(path: string): Promise<string>
}
