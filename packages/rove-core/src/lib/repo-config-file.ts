/** Read non-empty `.rove/` prompt files; blank files fall through to the user override. */

import { readFileSync } from "node:fs"
import { join } from "node:path"

/** Config dirs a repo may ship, canonical spelling first. */
export const REPO_CONFIG_DIRS = [".rove"] as const

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
