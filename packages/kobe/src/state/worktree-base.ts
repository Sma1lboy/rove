/**
 * Global override for the local worktree root (default
 * `<home>/.rove/worktrees`). The `<repo-key>/<slug>` layout below it is kept,
 * so repos never collide under a shared base.
 *
 * A leading `$project_dir` segment expands to the task's project root (e.g.
 * `$project_dir/../`); elsewhere it is a literal directory name.
 *
 * Read fresh from state.json on every path computation, so a change applies to
 * the next task without a daemon restart. Existing tasks keep their persisted
 * worktreePath, and the default root stays recognized for listing/slug
 * allocation (`managedWorktreeRootsFor`). Remote (SSH) projects are unaffected
 * (`remoteWorktreeRootFor`).
 */

import {
  PROJECT_DIR_TOKEN,
  WORKTREE_BASE_KEY,
  hasProjectDirToken,
  normalizeWorktreeBase,
} from "@sma1lboy/kobe-daemon/daemon/worktree-paths"
import { loadStateFile } from "./store.ts"

/**
 * The key's meaning is shared with the daemon (it resolves the same setting to
 * decide whether an engine cwd is an adoptable worktree); keep one copy. Only
 * the read policy (the State Store's corrupt-file backup) lives here.
 */
export { PROJECT_DIR_TOKEN, WORKTREE_BASE_KEY, hasProjectDirToken, normalizeWorktreeBase }

/** TUI-only: last custom path typed, restored when cycling back to `custom`. The daemon never reads it. */
export const WORKTREE_BASE_CUSTOM_KEY = "worktree.basePath.custom"

/** Stored value of the "next to project" preset: `<parent-of-repo>/<repo>-<hash>/<slug>`. */
export const PROJECT_SIBLING_BASE = `${PROJECT_DIR_TOKEN}/..`

export type WorktreeBaseKind = "default" | "nextToProject" | "custom"

/**
 * Classify a raw stored base path into the Settings presets: blank →
 * `default`, the `$project_dir/..` sibling preset (any trailing slashes
 * tolerated) → `nextToProject`, anything else → `custom`.
 */
export function worktreeBaseKindOf(raw: string): WorktreeBaseKind {
  const trimmed = raw.trim()
  if (!trimmed) return "default"
  if (trimmed.replace(/\/+$/, "") === PROJECT_SIBLING_BASE) return "nextToProject"
  return "custom"
}

/**
 * Absolute override path, or `null` when unset. Without `projectDir` a
 * `$project_dir` override falls back to the default root.
 */
export function getWorktreeBaseOverride(projectDir?: string): string | null {
  const value = loadStateFile()[WORKTREE_BASE_KEY]
  return normalizeWorktreeBase(typeof value === "string" ? value : null, projectDir)
}
