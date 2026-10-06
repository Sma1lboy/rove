/**
 * Settings for cloning a repo's gitignored directories into a new task
 * worktree (`orchestrator/worktree/clone-ignored.ts`).
 *   - Per-user off switch: state.json `worktree.cloneIgnored` (default on;
 *     only a literal `false` turns it off).
 *   - Per-repo directory list: `.rove/clone-dirs` in the new worktree, one
 *     directory name per line, `#` comments. A present, non-blank file replaces
 *     the defaults, so a comment-only file clones nothing for that repo.
 * Read fresh on every create, so an edit applies to the next task.
 */

import { readFirstNonEmptyRepoFile } from "../lib/repo-config-file.ts"
import { loadStateFile } from "./store.ts"

export const WORKTREE_CLONE_IGNORED_KEY = "worktree.cloneIgnored"

export const DEFAULT_CLONE_DIRS: readonly string[] = ["node_modules", ".venv", "target", ".build"]

export function isCloneIgnoredEnabled(): boolean {
  return loadStateFile()[WORKTREE_CLONE_IGNORED_KEY] !== false
}

/** Entries carrying a separator, `.`/`..` or a leading `-` are dropped: only bare directory names. */
export function parseCloneDirs(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter((e) => e.length > 0 && e !== "." && e !== ".." && !/[/\\]/.test(e) && !e.startsWith("-"))
}

/** Directory names to clone for the worktree: the repo file, else the defaults. */
export function resolveCloneDirs(worktreePath: string): readonly string[] {
  const file = readFirstNonEmptyRepoFile(worktreePath, "clone-dirs")
  return file === undefined ? DEFAULT_CLONE_DIRS : parseCloneDirs(file)
}
