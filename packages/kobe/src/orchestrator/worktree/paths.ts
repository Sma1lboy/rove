/**
 * The one definition of where Rove-managed worktrees live:
 * `~/.rove/worktrees/<repo-key>/<slug>/` (under `$ROVE_HOME_DIR` when set).
 * `<slug>` is an animal name, or a ULID on older persisted records. Legacy
 * repo-local roots (`<repo>/.kobe/worktrees/`, `<repo>/.claude/worktrees/`)
 * stay managed; new tasks use the global dir so no repo `.gitignore` entry is
 * needed. `<repo>` must be absolute; callers normalize.
 */

import fs from "node:fs"
import path from "node:path"
import {
  defaultLocalWorktreesRoot,
  legacyLocalWorktreesRoot,
  managedWorktreeRootsFor as managedWorktreeRootsForBase,
  worktreeRootFor as worktreeRootForBase,
} from "@sma1lboy/kobe-daemon/daemon/worktree-paths"
import { pathWithin } from "@sma1lboy/kobe-daemon/path-identity"
import { execHostForRepo } from "../../exec/resolve.ts"
import { getRemoteRepoConfig, isRemoteRepoKey } from "../../state/repos.ts"
import { getWorktreeBaseOverride } from "../../state/worktree-base.ts"

/** Re-exported from the shared derivation so the daemon and this module
 *  can't disagree about the layout. */
export {
  LEGACY_KOBE_WORKTREE_ROOT_SUBPATH,
  REPO_LOCAL_KOBE_WORKTREE_ROOT_SUBPATH,
  REPO_LOCAL_ROVE_WORKTREE_ROOT_SUBPATH,
} from "@sma1lboy/kobe-daemon/daemon/worktree-paths"

/** `/Users/x/proj` → `/Users/x/.rove/worktrees/proj-a1b2c3d4e5f6`, or
 *  `<override>/proj-a1b2c3d4e5f6`. */
export function worktreeRootFor(repo: string): string {
  return worktreeRootForBase(repo, getWorktreeBaseOverride(repo))
}

/** Override resolved. Order and the KNOWN LIMITATION (past override paths are
 *  not remembered) are documented in `daemon/worktree-paths`. */
export function managedWorktreeRootsFor(repo: string): readonly string[] {
  return managedWorktreeRootsForBase(repo, getWorktreeBaseOverride(repo))
}

/** `slug` is a {@link SlugAllocator} name or a legacy ULID. The single source
 *  for {@link import("./manager.ts").GitWorktreeManager.create}'s path. */
export function worktreePathFor(repo: string, slug: string): string {
  if (!slug || /[/\\\0]/.test(slug)) {
    throw new Error(`worktreePathFor: invalid slug: ${JSON.stringify(slug)}`)
  }
  return path.join(worktreeRootFor(repo), slug)
}

/**
 * Child dir names across all managed roots (missing/unreadable roots → none).
 * A stale dir from an aborted task still counts as a taken slug; `diagnose`
 * reconciles the index against it. Symlinks not followed. ASYNC because the
 * remote branch is an ssh round-trip inside the daemon.
 */
export async function listWorktreeDirNames(repo: string): Promise<string[]> {
  // A remote key isn't a local path; the local scan would throw on it.
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

/** The caller-form root containing `candidate`, or null. Both sides are
 *  realpath'd: git reports `/private/tmp`, callers pass `/tmp`. */
export function managedWorktreeRootForPath(repo: string, candidate: string): string | null {
  if (!path.isAbsolute(repo) || !path.isAbsolute(candidate)) return null
  const target = canonicalize(candidate)
  for (const rootPath of managedWorktreeRootsFor(repo)) {
    const root = canonicalize(rootPath)
    const rel = pathWithin(root, target)
    // The root itself is not a managed worktree; only descendants qualify.
    if (rel !== null && rel !== "") {
      return rootPath
    }
  }
  return null
}

/** False for plain `git worktree add` checkouts outside Rove's roots. */
export function isKobeManagedPath(repo: string, candidate: string): boolean {
  return managedWorktreeRootForPath(repo, candidate) !== null
}

/**
 * {@link isKobeManagedPath} without a repo: for `remove()` on a worktree whose
 * `.git` was destroyed (macOS pruning `/tmp`, deleted checkout), so no owner
 * is discoverable. Checks only the global roots (the per-repo subdir and
 * repo-local roots need the missing repo). Deliberately narrow: a yes
 * authorizes deleting a directory tree, so it must never accept a path Rove
 * didn't create.
 *
 * `projectDir` (e.g. `task.repo`) is REQUIRED for a `$project_dir` worktree
 * base to count: it expands per-repo. Without it, under the `$project_dir/..`
 * preset ("next to project") every Rove worktree reads unmanaged, and the
 * caller parks the task in `deletion.phase: "error"` forever.
 */
export function isUnderManagedWorktreesRoot(candidate: string, projectDir?: string): boolean {
  if (!path.isAbsolute(candidate)) return false
  const target = canonicalize(candidate)
  const roots = [getWorktreeBaseOverride(projectDir) ?? "", defaultLocalWorktreesRoot(), legacyLocalWorktreesRoot()]
  for (const rootPath of roots) {
    if (!rootPath) continue
    const root = canonicalize(rootPath)
    const rel = pathWithin(root, target)
    // EXACTLY `<repo-key>/<slug>` depth: this answer authorizes `rm -rf` in
    // `manager-remove.ts`, and any depth would let an override at `~` or
    // `~/code` say yes for every unrelated sibling project.
    if (rel === null) continue
    if (rel.split("/").filter(Boolean).length === 2) return true
  }
  return false
}

/** REMOTE layout: `<basePath>/.rove/worktrees/<slug>` (POSIX join; remotes
 *  are always POSIX). The main checkout is `basePath` itself. */
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

/** Remote {@link managedWorktreeRootForPath} (`.rove` or legacy `.kobe` root):
 *  pure string compare, no local realpath possible. */
export function remoteManagedRootForPath(basePath: string, candidate: string): string | null {
  for (const root of remoteManagedWorktreeRootsFor(basePath)) {
    if (candidate === root || candidate.startsWith(`${root}/`)) return root
  }
  return null
}

function stripTrailingSlash(p: string): string {
  return p.length > 1 && p.endsWith("/") ? p.replace(/\/+$/, "") : p
}

export function requireAbsolute(name: string, value: string): void {
  if (!value || !path.isAbsolute(value)) {
    throw new Error(`${name} must be an absolute path, got: ${JSON.stringify(value)}`)
  }
}

/** macOS `/tmp` and `/var/folders` symlink into `/private/`. Falls back to
 *  `path.resolve` for a not-yet-created target. */
export function canonicalize(p: string): string {
  try {
    return fs.realpathSync(p)
  } catch {
    return path.resolve(p)
  }
}
