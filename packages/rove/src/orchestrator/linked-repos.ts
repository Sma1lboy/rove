/**
 * Symlinks inside a workspace that point at other git checkouts
 * (`auto-director -> ~/i/auto-director`). A worktree of the workspace copies
 * the symlink, not the checkout, so edits under it land in the one shared repo.
 */

import { lstatSync, readdirSync, realpathSync } from "node:fs"
import { join } from "node:path"
import { pathWithin, samePath } from "@sma1lboy/rove-daemon/path-identity"
import { isGitRepo, resolveRepoRoot } from "../state/repos.ts"

export interface LinkedRepo {
  /** Entry name in the workspace root. */
  readonly name: string
  /** Realpath of the linked git toplevel. */
  readonly path: string
}

/** Top-level symlinks of `workspaceDir` whose realpath is a git toplevel outside it, by name. */
export function scanLinkedRepos(workspaceDir: string): LinkedRepo[] {
  let workspace: string
  let names: string[]
  try {
    workspace = realpathSync(workspaceDir)
    names = readdirSync(workspaceDir)
  } catch {
    return []
  }
  const out: LinkedRepo[] = []
  for (const name of names.sort()) {
    const entry = join(workspaceDir, name)
    try {
      if (!lstatSync(entry).isSymbolicLink()) continue
      const target = realpathSync(entry)
      if (pathWithin(workspace, target) !== null) continue
      if (isGitRepo(target) && samePath(resolveRepoRoot(target), target)) out.push({ name, path: target })
    } catch {
      // Dangling link or unreadable target: not a linked repo.
    }
  }
  return out
}
