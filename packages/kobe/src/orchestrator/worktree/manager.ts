/**
 * `WorktreeManager` over `git worktree add/remove/list` plus dirty/branch
 * probes. Invariants:
 *   - `create()` is idempotent on the same branch and throws on a different
 *     one — never hijack.
 *   - `create()` makes a missing branch (at `baseRef` or HEAD) and reuses an
 *     existing one, never fast-forwarding it.
 *   - `remove()` refuses a dirty worktree unless `force`. The most important
 *     safety property here: no lost changes without explicit consent.
 *   - `list()` returns only Rove-managed roots (`~/.rove/worktrees/<repo-key>/`
 *     plus legacy global/repo-local roots).
 * Reference (read, not ported): `refs/vibe-kanban/crates/worktree-manager/`.
 */

import path from "node:path"
import type { ExecHost } from "../../exec/exec-host.ts"
import { READ_ONLY_GIT_ENV } from "../../lib/git-env.ts"
import type { AdoptableWorktree, WorktreeInfo, WorktreeManager } from "../../types/worktree.ts"
import { isDirtyOutput } from "../dirty-paths.ts"
import { type ExecCtx, type WorktreeExecDeps, defaultExecDeps } from "./exec-deps.ts"
import { GitCommandError, type GitRunOpts, type GitRunResult } from "./git.ts"
import {
  type BranchDeleteOutcome,
  type BranchDeps,
  branchExists,
  branchHasUpstream,
  deleteBranchAnchored,
  hasLocalBranch,
  renameBranch,
} from "./manager-branch.ts"
import {
  type ListDeps,
  adoptablePaths,
  listAllAdoptable,
  listBranchNames,
  listManaged,
  unreadableWorktreeNames,
} from "./manager-list.ts"
import { type RemoveOpts, removeWorktree } from "./manager-remove.ts"
import { canonicalize, remoteWorktreePathFor, requireAbsolute, worktreePathFor } from "./paths.ts"
import { type IgnoredWorkProbe, smallIgnoredPaths } from "./salvage-ignored.ts"
import type { SalvageRecord } from "./salvage.ts"
import { parseWorktreeListPorcelain } from "./worktree-list.ts"

export class GitWorktreeManager implements WorktreeManager {
  constructor(private readonly execDeps: WorktreeExecDeps = defaultExecDeps) {}

  private ctxFor(repoKey: string): ExecCtx {
    const basePath = this.execDeps.remoteBasePath(repoKey)
    return basePath
      ? { exec: this.execDeps.execForRepo(repoKey), dir: basePath, remote: true }
      : { exec: this.execDeps.execForRepo(repoKey), dir: repoKey, remote: false }
  }

  /**
   * git.ts's throw-on-nonzero / `allowFail` contract, local or remote. ASYNC:
   * a big-repo `worktree add` takes minutes and a remote call is an ssh
   * round-trip; the daemon's event loop keeps serving meanwhile.
   */
  private async runGit(exec: ExecHost, args: readonly string[], opts: GitRunOpts): Promise<GitRunResult> {
    if (!opts.cwd) {
      throw new Error("runGit(): cwd is required; refusing to inherit from process.cwd()")
    }
    // Read-only probes must not compete with an engine's commit for
    // `.git/index.lock`; the flag wins over caller env.
    const env = opts.readOnly ? { ...opts.env, ...READ_ONLY_GIT_ENV } : opts.env
    const r = await exec.run(["git", ...args], { cwd: opts.cwd, env })
    const result: GitRunResult = { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode }
    if (result.exitCode !== 0 && !opts.allowFail) {
      throw new GitCommandError(args, opts.cwd, result)
    }
    return result
  }
  /**
   * `baseRef` (anything `worktree add -b <new> <path> <baseRef>` accepts,
   * default HEAD) applies only to a fresh branch; an existing branch ignores
   * it rather than being moved onto a new base. See {@link createForTask}.
   */
  async create(repo: string, branch: string, worktreePath: string, baseRef?: string): Promise<WorktreeInfo> {
    const ctx = this.ctxFor(repo)
    requireAbsolute("repo", ctx.dir)
    requireAbsolute("path", worktreePath)
    if (!branch) throw new Error("create(): branch must be a non-empty string")

    if (await ctx.exec.exists(worktreePath)) {
      const existing = await this.tryDescribe(ctx, worktreePath)
      if (existing) {
        if (existing.branch !== branch) {
          throw new Error(
            `worktree at ${worktreePath} is on branch '${existing.branch}', refusing to hijack to '${branch}'`,
          )
        }
        return existing
      }
      // Likely stale debris from a failed run, but it may hold user files:
      // surface, never nuke.
      throw new Error(`create(): ${worktreePath} exists but is not a registered git worktree`)
    }

    await ctx.exec.mkdirp(path.dirname(worktreePath))

    const exists = await branchExists(this.branchDeps(), ctx, branch)
    const args = exists
      ? ["worktree", "add", worktreePath, branch]
      : baseRef
        ? ["worktree", "add", "-b", branch, worktreePath, baseRef]
        : ["worktree", "add", "-b", branch, worktreePath]

    await this.runGit(ctx.exec, args, { cwd: ctx.dir })

    // Fail here, not at the first downstream `currentBranch()`.
    const info = await this.tryDescribe(ctx, worktreePath)
    if (!info) {
      throw new Error(`create(): git reported success but ${worktreePath} is not a worktree`)
    }
    if (info.branch !== branch) {
      throw new Error(
        `create(): post-condition failed — expected branch '${branch}' at ${worktreePath}, got '${info.branch}'`,
      )
    }
    return info
  }

  /** Computes the path here so callers can't disagree on the layout. `slug` is
   *  the directory basename from {@link SlugAllocator}; opaque to the manager. */
  async createForTask(args: {
    repo: string
    slug: string
    branch: string
    baseRef?: string
  }): Promise<WorktreeInfo> {
    // Remote: under its basePath, not the local `~/.rove/worktrees`.
    const basePath = this.execDeps.remoteBasePath(args.repo)
    const target = basePath ? remoteWorktreePathFor(basePath, args.slug) : worktreePathFor(args.repo, args.slug)
    return this.create(args.repo, args.branch, target, args.baseRef)
  }

  /** Refuses a dirty worktree unless `opts.force`; a forced removal salvages
   *  first and can clear a worktree whose repo is gone. */
  async remove(worktreePath: string, opts?: RemoveOpts): Promise<void> {
    await removeWorktree(
      {
        runGit: (exec, args, runOpts) => this.runGit(exec, args, runOpts),
        execForPath: (p) => this.execDeps.execForPath(p),
        findRepoFor: (exec, p) => this.findRepoFor(exec, p),
        currentBranch: (p) => this.currentBranch(p),
        isDirty: (p) => this.isDirty(p),
        ignoredWork: (p) => this.ignoredWork(p),
        branchDeps: () => this.branchDeps(),
      },
      worktreePath,
      opts,
    )
  }

  /** A forced delete anchors an otherwise-unreachable tip first
   *  ({@link deleteBranchAnchored}). */
  async deleteBranch(
    repo: string,
    branch: string,
    opts?: {
      readonly force?: boolean
      /** null = not needed, or couldn't be written. */
      readonly onAnchor?: (record: SalvageRecord | null) => void
    },
  ): Promise<BranchDeleteOutcome> {
    const ctx = this.ctxFor(repo)
    requireAbsolute("repo", ctx.dir)
    return await deleteBranchAnchored(this.branchDeps(), ctx.exec, ctx.dir, branch, {
      force: opts?.force === true,
      onAnchor: opts?.onAnchor,
    })
  }

  /** Binds `requireAbsolute` in so forgetting it is unrepresentable. */
  private execAt(worktreePath: string): ExecHost {
    requireAbsolute("path", worktreePath)
    return this.execDeps.execForPath(worktreePath)
  }

  private branchDeps(): BranchDeps {
    return {
      runGit: (exec, args, opts) => this.runGit(exec, args, opts),
      execAt: (worktreePath) => this.execAt(worktreePath),
      findRepoFor: (exec, worktreePath) => this.findRepoFor(exec, worktreePath),
    }
  }

  private listDeps(): ListDeps {
    return {
      ctxFor: (repoKey) => this.ctxFor(repoKey),
      runGitStdout: async (ctx, args) => (await this.runGit(ctx.exec, args, { cwd: ctx.dir, readOnly: true })).stdout,
      runGitStdoutAt: async (ctx, cwd, args) => (await this.runGit(ctx.exec, args, { cwd, readOnly: true })).stdout,
      isDirty: (worktreePath) => this.isDirty(worktreePath),
    }
  }

  /** Only Rove-managed roots; other worktrees are invisible. */
  list(repo: string): Promise<readonly WorktreeInfo[]> {
    return listManaged(this.listDeps(), repo)
  }

  /** Every adoption candidate (not main checkout, detached or bare), probed. */
  listAll(repo: string): Promise<readonly AdoptableWorktree[]> {
    return listAllAdoptable(this.listDeps(), repo)
  }

  /** {@link listAll} without the per-worktree dirty/log probes: validating one
   *  adopt candidate is one porcelain list instead of O(N) spawns. */
  listAdoptablePaths(repo: string): Promise<readonly { readonly path: string; readonly branch: string }[]> {
    return adoptablePaths(this.listDeps(), this.ctxFor(repo))
  }

  /** Admin-dir names `git worktree list` silently omitted. */
  listUnreadableWorktrees(repo: string): Promise<readonly string[]> {
    return unreadableWorktreeNames(this.listDeps(), this.ctxFor(repo))
  }

  listBranchNames(repo: string): Promise<readonly string[]> {
    return listBranchNames(this.listDeps(), repo)
  }

  /** Local fs, or remote `test -e`. */
  async pathExists(worktreePath: string): Promise<boolean> {
    return this.execAt(worktreePath).exists(worktreePath)
  }

  /**
   * Drops `.git/worktrees/<name>/` registrations whose dir was deleted
   * out-of-band. Best-effort. Needed before re-materialising a task whose dir
   * vanished: `worktree add` on a still-registered path errors.
   */
  async pruneWorktrees(repo: string): Promise<void> {
    const ctx = this.ctxFor(repo)
    requireAbsolute("repo", ctx.dir)
    await this.runGit(ctx.exec, ["worktree", "prune"], { cwd: ctx.dir, allowFail: true })
  }

  /** `status --porcelain` non-empty. Untracked counts, so `remove()` never
   *  nukes a fresh worktree's uncommitted new files. */
  async isDirty(worktreePath: string): Promise<boolean> {
    const out = await this.runGit(this.execAt(worktreePath), ["status", "--porcelain"], {
      cwd: worktreePath,
      readOnly: true,
    })
    return isDirtyOutput(out.stdout)
  }

  /**
   * Gitignored paths a delete would destroy (`HANDOFF.md`, `.scratch/**`,
   * `.env*`). Separate from `isDirty`: they survive land and sync, so folding
   * them in would make any `.env` worktree read dirty to the sidebar and land
   * preflight. Same rule as the salvage snapshot ({@link smallIgnoredPaths}):
   * the gate refuses for exactly what `--force` would rescue; a huge
   * `node_modules/` is over the ceiling and does neither. `"unknown"` passes
   * through — "could not look" is not "nothing here".
   */
  async ignoredWork(worktreePath: string): Promise<IgnoredWorkProbe> {
    return smallIgnoredPaths(this.execAt(worktreePath), worktreePath)
  }

  /** Throws on detached HEAD (rev-parse prints `HEAD`) rather than returning a
   *  meaningless name. */
  async currentBranch(worktreePath: string): Promise<string> {
    const out = await this.runGit(this.execAt(worktreePath), ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: worktreePath,
      readOnly: true,
    })
    const name = out.stdout.trim()
    if (!name || name === "HEAD") {
      throw new Error(`currentBranch(): ${worktreePath} is in detached-HEAD state`)
    }
    return name
  }

  branchHasUpstream(worktreePath: string, branch: string): Promise<boolean> {
    return branchHasUpstream(this.branchDeps(), worktreePath, branch)
  }

  hasLocalBranch(worktreePath: string, branch: string): Promise<boolean> {
    return hasLocalBranch(this.branchDeps(), worktreePath, branch)
  }

  renameBranch(worktreePath: string, from: string, to: string): Promise<void> {
    return renameBranch(this.branchDeps(), worktreePath, from, to)
  }

  // ---------- internals ----------

  /** Null when not a registered worktree: `create()`'s "already done" vs
   *  "stale debris" test. */
  private async tryDescribe(ctx: ExecCtx, worktreePath: string): Promise<WorktreeInfo | null> {
    const out = await this.runGit(ctx.exec, ["worktree", "list", "--porcelain"], { cwd: ctx.dir, readOnly: true })
    const entries = parseWorktreeListPorcelain(out.stdout)
    // Remote paths can't be realpath'd locally; compare them verbatim.
    const norm = (p: string) => (ctx.remote ? p : canonicalize(p))
    const target = norm(worktreePath)
    const match = entries.find((e) => e.path && norm(e.path) === target)
    if (!match || !match.path || !match.branch || match.detached) return null
    return {
      // The caller's path verbatim, not git's `/private/...` form: callers
      // compare against the exact string later.
      path: worktreePath,
      branch: match.branch,
      head: match.head ?? "",
      dirty: await this.isDirty(match.path),
    }
  }

  /** The owning repo's working tree (parent of `--git-common-dir`, the shared
   *  `.git`), or null when not a worktree. */
  private async findRepoFor(exec: ExecHost, worktreePath: string): Promise<string | null> {
    try {
      const out = await this.runGit(exec, ["rev-parse", "--git-common-dir"], {
        cwd: worktreePath,
        allowFail: true,
        readOnly: true,
      })
      if (out.exitCode !== 0) return null
      const gitDir = out.stdout.trim()
      if (!gitDir) return null
      const absolute = path.isAbsolute(gitDir) ? gitDir : path.resolve(worktreePath, gitDir)
      const base = path.basename(absolute)
      return base === ".git" ? path.dirname(absolute) : absolute
    } catch (err) {
      if (err instanceof GitCommandError) return null
      throw err
    }
  }
}
