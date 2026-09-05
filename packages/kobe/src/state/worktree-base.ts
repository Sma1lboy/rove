/**
 * Global worktree base-path override.
 *
 * By default Rove stores every LOCAL task worktree under
 * `<home>/.rove/worktrees/<repo-key>/<slug>` (see
 * `orchestrator/worktree/paths.ts`). This module owns the one optional
 * knob that relocates that `<home>/.rove/worktrees` root to a
 * user-chosen directory — e.g. a faster disk, or a folder the user
 * already keeps their scratch checkouts in. The per-repo `<repo-key>`
 * namespacing below it is preserved, so worktrees from different repos
 * never collide under a shared base.
 *
 * The value may start with the `$project_dir` token, which expands to
 * the task's project root at path-computation time — one global setting
 * that yields a per-project layout (e.g. `$project_dir/../` puts the
 * worktrees root next to each project). The token is only recognized as
 * the leading path segment; anywhere else it is a literal directory name.
 *
 * Stored in the shared state.json (the Settings dialog's KV writes the
 * same file) and read FRESH on every worktree-path computation, so
 * changing it takes effect for the next task with no daemon restart.
 * Only NEW tasks move: existing tasks keep their persisted worktreePath,
 * and the earlier default root stays recognized for listing/slug allocation
 * (see `managedWorktreeRootsFor`).
 *
 * Remote (SSH) projects are unaffected — their worktrees live on the
 * remote host under the project's own `basePath` (`remoteWorktreeRootFor`).
 */

import {
  PROJECT_DIR_TOKEN,
  WORKTREE_BASE_KEY,
  hasProjectDirToken,
  normalizeWorktreeBase,
} from "@sma1lboy/kobe-daemon/daemon/worktree-paths"
import { loadStateFile } from "./store.ts"

/**
 * The key and its interpretation live in
 * `@sma1lboy/kobe-daemon/daemon/worktree-paths` — the daemon resolves the very
 * same setting when it decides whether an engine's cwd is an adoptable
 * worktree, and a second copy of "what does this string mean" is exactly what
 * drifted before. Only the READ policy is this module's (the State Store's
 * corrupt-file backup); the meaning is shared.
 */
export { PROJECT_DIR_TOKEN, WORKTREE_BASE_KEY, hasProjectDirToken, normalizeWorktreeBase }

/**
 * TUI-only companion key remembering the last custom path the user
 * typed, so cycling the setting away from `custom` and back restores it
 * instead of forcing a retype. The daemon never reads this.
 */
export const WORKTREE_BASE_CUSTOM_KEY = "worktree.basePath.custom"

/**
 * The stored value behind the "next to project" preset: worktrees land
 * beside each repo (`<parent-of-repo>/<repo>-<hash>/<slug>`).
 */
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
 * The configured worktree base override as an absolute path, or `null`
 * when unset. Read fresh from state.json on every call. `projectDir`
 * (the repo root the path is being computed for) is required for a
 * `$project_dir` override to take effect — without it the token falls
 * back to the default root.
 */
export function getWorktreeBaseOverride(projectDir?: string): string | null {
  const value = loadStateFile()[WORKTREE_BASE_KEY]
  return normalizeWorktreeBase(typeof value === "string" ? value : null, projectDir)
}
