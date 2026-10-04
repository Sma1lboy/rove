/** Path / repo-key normalisation for the {@link Orchestrator} that reads no orchestrator state. */

import { getRemoteRepoConfig, isRemoteRepoKey, resolveRepoRoot } from "../state/repos.ts"
import { canonicalize } from "./worktree/paths.ts"

/** Resolve symlinks (macOS `/var` → `/private/var`) so caller-form and git-form
 *  paths of one worktree compare equal. Alias of {@link canonicalize}. */
export const canonPath = canonicalize

/** Every open of a directory is a NEW `kind:"dir"` task, so titles need a
 *  distinct suffix (4 base36 chars ≈ 1.7M). */
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

/** The local repo path, or a remote project's `basePath` (the ssh:// key isn't a usable path). */
export function repoWorkingDir(repo: string): string {
  return getRemoteRepoConfig(repo)?.basePath ?? repo
}
