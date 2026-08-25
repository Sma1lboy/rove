/**
 * Pure, `this`-independent helpers for the {@link Orchestrator} (`core.ts`).
 *
 * Path / repo-key normalisation with no orchestrator state — split out so the
 * class stays under the file-size cap. Moved verbatim from `core.ts`.
 */

import { realpathSync } from "node:fs"
import { resolve } from "node:path"
import { getRemoteRepoConfig, isRemoteRepoKey, resolveRepoRoot } from "../state/repos.ts"

/**
 * Resolve symlinks so two strings naming the same node compare equal
 * (macOS `/var` → `/private/var`). Falls back to `resolve` when the path
 * doesn't exist. Used to de-dupe discovered worktrees against task paths,
 * which may be stored in different (caller vs git) forms.
 */
export function canonPath(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    return resolve(p)
  }
}

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
