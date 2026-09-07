/**
 * Canonical filesystem layout for Rove-managed worktrees.
 *
 * The worktree root is per-repo and lives in Rove's state dir at
 * `~/.rove/worktrees/<repo-key>/<slug>/` (or under `$ROVE_HOME_DIR`
 * when overridden). `<slug>` is an animal-name slug for tasks
 * created after the switch, or the task's ULID for older records whose
 * path is already persisted.
 *
 * Backwards compatibility: older checkouts hold worktrees under
 * repo-local `<repo>/.kobe/worktrees/<slug>/` or
 * `<repo>/.claude/worktrees/<slug>/`. Existing tasks in both roots
 * remain managed and discoverable, but new Rove-created tasks use the
 * global Rove state dir so no repo-level `.gitignore` entry is needed.
 *
 * Keeping this in one place means the orchestrator, the worktree
 * manager, the task index, and any future "list all kobe worktrees"
 * tool agree on where to look — no string concatenation scattered
 * across modules.
 *
 * `<repo>` is always absolute. Callers must normalize before invoking.
 */

import fs from "node:fs"
import path from "node:path"
import {
  defaultLocalWorktreesRoot,
  legacyLocalWorktreesRoot,
  managedWorktreeRootsFor as managedWorktreeRootsForBase,
  worktreeRootFor as worktreeRootForBase,
} from "@sma1lboy/kobe-daemon/daemon/worktree-paths"
import { execHostForRepo } from "../../exec/resolve.ts"
import { getRemoteRepoConfig, isRemoteRepoKey } from "../../state/repos.ts"
import { getWorktreeBaseOverride } from "../../state/worktree-base.ts"

/**
 * Repo-local compatibility roots, re-exported from the shared derivation in
 * `@sma1lboy/kobe-daemon/daemon/worktree-paths` so the daemon's own recognition
 * pass and this module can no longer disagree about the layout.
 */
export {
  LEGACY_KOBE_WORKTREE_ROOT_SUBPATH,
  REPO_LOCAL_KOBE_WORKTREE_ROOT_SUBPATH,
  REPO_LOCAL_ROVE_WORKTREE_ROOT_SUBPATH,
} from "@sma1lboy/kobe-daemon/daemon/worktree-paths"

/**
 * Absolute path of the worktree root for a given repo.
 *
 * Example: `worktreeRootFor("/Users/x/proj")` →
 * `/Users/x/.rove/worktrees/proj-a1b2c3d4e5f6` (or, when a base override
 * is set, `<override>/proj-a1b2c3d4e5f6`).
 */
export function worktreeRootFor(repo: string): string {
  return worktreeRootForBase(repo, getWorktreeBaseOverride(repo))
}

/**
 * Every worktree root Rove recognizes for `repo`, override resolved. Root
 * order and the KNOWN LIMITATION (past override paths are not remembered)
 * are documented on the implementation in `daemon/worktree-paths`.
 */
export function managedWorktreeRootsFor(repo: string): readonly string[] {
  return managedWorktreeRootsForBase(repo, getWorktreeBaseOverride(repo))
}

/**
 * Absolute path of the worktree directory keyed by `slug` in `repo`.
 *
 * `slug` is the workspace's directory basename — an animal-name slug
 * allocated by {@link SlugAllocator} for tasks created since the slug scheme landed,
 * or the task's ULID for older tasks whose worktree was created back
 * when "dir name == task id" was the invariant.
 *
 * Single source of truth: the orchestrator computes the path via this
 * helper and hands it to {@link import("./manager.ts").GitWorktreeManager.create},
 * so the two modules can never disagree on the layout.
 */
export function worktreePathFor(repo: string, slug: string): string {
  if (!slug || /[/\\\0]/.test(slug)) {
    throw new Error(`worktreePathFor: invalid slug: ${JSON.stringify(slug)}`)
  }
  return path.join(worktreeRootFor(repo), slug)
}

/**
 * Immediate child directory names under every managed root for `repo`.
 *
 * Returns an empty array when no root exists yet (the very
 * first task in a repo) or can't be read. Used by the slug allocator
 * to discover on-disk-occupied slugs (so a stale dir from an aborted
 * task still counts as taken) and by `diagnose` to reconcile the task
 * index against disk state. Symlinks are not followed.
 *
 * ASYNC: the remote branch is an ssh round-trip (`ExecHost.readdir`) and
 * runs inside the daemon (slug allocation) — it must not block the event
 * loop. The local branch stays a cheap sync scan under the hood.
 */
export async function listWorktreeDirNames(repo: string): Promise<string[]> {
  // A remote project lists its worktree dirs over SSH (its key isn't a local
  // path, so the local-root scan below would throw on the non-absolute key).
  if (isRemoteRepoKey(repo)) {
    const basePath = getRemoteRepoConfig(repo)?.basePath
    if (!basePath) return []
    const names = new Set<string>()
    const host = execHostForRepo(repo)
    const entries = await Promise.all(remoteManagedWorktreeRootsFor(basePath).map((root) => host.readdir(root)))
    for (const list of entries) for (const name of list) names.add(name)
    return [...names]
  }
  const names = new Set<string>()
  for (const root of managedWorktreeRootsFor(repo)) {
    try {
      for (const e of fs.readdirSync(root, { withFileTypes: true })) {
        if (e.isDirectory()) names.add(e.name)
      }
    } catch {
      // A missing/unreadable root simply contributes no occupied names.
    }
  }
  return [...names]
}

/**
 * Return the caller-form managed root that contains `candidate`, or
 * null when `candidate` is not inside any kobe-managed worktree root
 * for `repo`.
 *
 * Canonicalizes both sides via `fs.realpathSync` when possible so that
 * macOS's `/tmp` ↔ `/private/tmp` symlink aliasing doesn't cause us to
 * miss our own worktrees (git reports the resolved form, helpers return
 * the caller's form).
 */
export function managedWorktreeRootForPath(repo: string, candidate: string): string | null {
  if (!path.isAbsolute(repo) || !path.isAbsolute(candidate)) return null
  const target = canonicalize(candidate)
  for (const rootPath of managedWorktreeRootsFor(repo)) {
    const root = canonicalize(rootPath)
    const rel = path.relative(root, target)
    // path.relative returns ".." prefix when outside; an absolute path
    // when on a different drive (Windows). Either rules it out.
    if (rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)) {
      return rootPath
    }
  }
  return null
}

/**
 * True iff `candidate` lives inside a kobe-managed worktree root for
 * `repo`. Used by `list()` to filter out worktrees the user (or another
 * tool) created via plain `git worktree add`.
 */
export function isKobeManagedPath(repo: string, candidate: string): boolean {
  return managedWorktreeRootForPath(repo, candidate) !== null
}

/**
 * True iff `candidate` sits under a Rove-managed worktrees root, WITHOUT
 * needing to know which repo owns it.
 *
 * `isKobeManagedPath` answers the same question but takes a repo, and the one
 * caller that needs this is the case where the repo cannot be resolved at all:
 * a worktree whose upstream `.git` was destroyed (macOS pruning `/tmp`, a
 * deleted checkout) has no discoverable owner, so `remove()` cannot use the
 * repo-keyed form to decide whether the directory is its own to delete.
 *
 * Only the roots THEMSELVES are checked, not the per-repo subdir under them —
 * that subdir is derived from the repo path, which the sole caller may not
 * have. The guard is deliberately narrow: it authorizes deleting a directory
 * tree, so it must never say yes to a path Rove did not create. A repo-local
 * root (`<repo>/.rove/worktrees`) is not recognized here — that form needs the
 * repo to locate, which is exactly what is missing when it is.
 *
 * `projectDir` is the repo that owns `candidate`, when the caller knows it
 * (a task record carries `task.repo`). It is REQUIRED for a `$project_dir`
 * worktree base to be recognized at all: that override expands per-repo, so
 * without one it contributes no root and the answer collapses to the built-in
 * default. Under the shipped `$project_dir/..` preset (Settings → "next to
 * project") every worktree lives outside every default root, so the guard
 * answered false for paths Rove itself had created — and the one caller turns
 * that into a permanent refusal, parking the task in `deletion.phase: "error"`
 * where every retry re-runs the same unsatisfiable branch.
 */
export function isUnderManagedWorktreesRoot(candidate: string, projectDir?: string): boolean {
  if (!path.isAbsolute(candidate)) return false
  const target = canonicalize(candidate)
  const roots = [getWorktreeBaseOverride(projectDir) ?? "", defaultLocalWorktreesRoot(), legacyLocalWorktreesRoot()]
  for (const rootPath of roots) {
    if (!rootPath) continue
    const root = canonicalize(rootPath)
    const rel = path.relative(root, target)
    // No ".." prefix (outside), not absolute (different drive on Windows), and
    // EXACTLY the `<repo-key>/<slug>` shape this module creates (see
    // `worktreePathFor`). Accepting any depth meant a Settings worktree-location
    // override pointed at `~` or `~/code` let every unrelated sibling project
    // answer yes here — and this answer is what authorizes `rm -rf` in
    // `manager-remove.ts`.
    if (rel.startsWith("..") || path.isAbsolute(rel)) continue
    if (rel.split(path.sep).filter(Boolean).length === 2) return true
  }
  return false
}

/**
 * Worktree layout for a REMOTE project. The local `~/.rove/worktrees/...`
 * root can't be used — the worktree lives on the remote host. We root it
 * under the project's remote `basePath` in a `.rove/worktrees/<slug>` subdir
 * (POSIX join: the remote is always POSIX). The main checkout the worktree is
 * added from is `basePath` itself.
 */
function remoteWorktreeRootFor(basePath: string): string {
  return `${stripTrailingSlash(basePath)}/.rove/worktrees`
}

function remoteManagedWorktreeRootsFor(basePath: string): readonly string[] {
  const base = stripTrailingSlash(basePath)
  return [`${base}/.rove/worktrees`, `${base}/.kobe/worktrees`]
}

export function remoteWorktreePathFor(basePath: string, slug: string): string {
  if (!slug || /[/\\\0]/.test(slug)) {
    throw new Error(`remoteWorktreePathFor: invalid slug: ${JSON.stringify(slug)}`)
  }
  return `${remoteWorktreeRootFor(basePath)}/${slug}`
}

/**
 * Remote analogue of {@link managedWorktreeRootForPath}: is `candidate` under
 * `<basePath>/.rove/worktrees` or its `.kobe` predecessor? Pure string compare on POSIX remote paths (no
 * local realpath possible). Returns the remote root when matched, else null.
 */
export function remoteManagedRootForPath(basePath: string, candidate: string): string | null {
  for (const root of remoteManagedWorktreeRootsFor(basePath)) {
    if (candidate === root || candidate.startsWith(`${root}/`)) return root
  }
  return null
}

function stripTrailingSlash(p: string): string {
  return p.length > 1 && p.endsWith("/") ? p.replace(/\/+$/, "") : p
}

/** Throw unless `value` is a non-empty absolute path (`name` labels the error). */
export function requireAbsolute(name: string, value: string): void {
  if (!value || !path.isAbsolute(value)) {
    throw new Error(`${name} must be an absolute path, got: ${JSON.stringify(value)}`)
  }
}

/**
 * Resolve symlinks on a path so two strings that name the same node
 * compare equal. Necessary on macOS where `/tmp` and `/var/folders/...`
 * are symlinks into `/private/`. Falls back to `path.resolve` if the
 * path doesn't exist (we're sometimes asked about a target that's not
 * yet created).
 */
export function canonicalize(p: string): string {
  try {
    return fs.realpathSync(p)
  } catch {
    return path.resolve(p)
  }
}
