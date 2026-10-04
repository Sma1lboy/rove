/**
 * One reader for the `.rove/` → `.kobe/` per-repo config-file fallback.
 *
 * Covers `init.sh`, `init-prompt.md`, `pr-instructions.md` and
 * `ci-instructions.md`; legacy `.kobe/` stays a fallback. A whitespace-only
 * file is a placeholder that falls through, not an instruction to blank the
 * output.
 *
 * Sync on purpose: small files read once per launch or user action, and one
 * reader can't drift from an async copy.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

/** Config dirs a repo may ship, canonical spelling first. */
export const REPO_CONFIG_DIRS = [".rove", ".kobe"] as const

/** Every candidate path for `filename`, in precedence order. */
function repoConfigCandidates(repoDir: string, filename: string): string[] {
  return REPO_CONFIG_DIRS.map((dir) => join(repoDir, dir, filename))
}

/**
 * Contents of the first candidate that exists and holds more than whitespace,
 * or `undefined` when none does. An unreadable or absent file never blocks the
 * next candidate.
 */
export function readFirstNonEmptyRepoFile(repoDir: string, filename: string): string | undefined {
  for (const candidate of repoConfigCandidates(repoDir, filename)) {
    if (isNonEmptyRepoFile(candidate)) return readFileSync(candidate, "utf8")
  }
  return undefined
}

/**
 * Readable and more than whitespace: the single definition of "counts", so a
 * diagnostic can't disagree with the code that picks.
 */
export function isNonEmptyRepoFile(absolutePath: string): boolean {
  try {
    return readFileSync(absolutePath, "utf8").trim().length > 0
  } catch {
    return false
  }
}
