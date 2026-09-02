/**
 * Pure, `this`-independent helpers for the {@link Orchestrator} (`core.ts`).
 *
 * The seam is `this`: everything here is path / repo-key normalisation that
 * reads no orchestrator state, so it is testable as plain input → output and
 * can be called from anywhere without an Orchestrator to hand. Keeping it out
 * of the class is what stops these from quietly growing a dependency on it.
 * Moved verbatim from `core.ts`.
 */

import { getRemoteRepoConfig, isRemoteRepoKey, resolveRepoRoot } from "../state/repos.ts"
import { canonicalize } from "./worktree/paths.ts"

/**
 * Resolve symlinks so two strings naming the same node compare equal
 * (macOS `/var` → `/private/var`). Used to de-dupe discovered worktrees
 * against task paths, which may be stored in different (caller vs git)
 * forms. The one implementation is {@link canonicalize} in
 * `worktree/paths.ts`; this name is kept so its call sites stay put.
 */
export const canonPath = canonicalize

/**
 * Short random suffix for `kind:"dir"` task titles (`kobe .`): every open
 * of the same directory is a NEW task, so the rows need distinct titles.
 * 4 base36 chars ≈ 1.7M combinations — plenty for a sidebar list.
 */
export function randomDirTaskSuffix(): string {
  return Math.random().toString(36).slice(2, 6).padEnd(4, "0")
}

export function titleFromRepo(repo: string): string {
  const segs = repo.split(/[/\\]/).filter(Boolean)
  return segs.length > 0 ? (segs[segs.length - 1] ?? repo) : repo
}

export function normalizeMainRepo(repo: string): { repo: string; key: string } {
  const normalized = resolveRepoRoot(repo)
  return {
    repo: normalized,
    key: isRemoteRepoKey(normalized) ? normalized : canonPath(normalized),
  }
}

/**
 * The on-disk working dir a project key resolves to: the local repo path, or a
 * remote project's `basePath` (the ssh:// key isn't a usable path). The main
 * task and the engine's `cd` target both key off this.
 */
export function repoWorkingDir(repo: string): string {
  return getRemoteRepoConfig(repo)?.basePath ?? repo
}
