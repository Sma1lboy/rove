/**
 * One reader for the `.rove/` → `.kobe/` per-repo config-file fallback.
 *
 * A repo can ship `init.sh`, `init-prompt.md`, `pr-instructions.md` and
 * `ci-instructions.md` under `.rove/`, with the legacy `.kobe/` spelling kept
 * as a fallback so repos that committed one before the rename keep working.
 * Three call sites hand-rolled that loop and disagreed about what counts as a
 * file worth using: `state/repo-init.ts` skipped whitespace-only files, while
 * `tui/ops/pr-prompt.ts` and `tui/ops/ci-prompt.ts` accepted them — so a
 * `.rove/pr-instructions.md` holding a single newline was returned as the
 * template and blanked the prompt, where the same file in `repo-init.ts` fell
 * through to `.kobe/`.
 *
 * `repo-init.ts` had the rule the comments in all three describe, so trimming
 * is the shared answer: a file of nothing but whitespace is a placeholder, not
 * an instruction to blank the output.
 *
 * Sync on purpose. These are two small repo-local files read once per engine
 * launch or per user-triggered action, and one shared reader beats a sync and
 * an async copy that can drift apart again.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

/** Config dirs a repo may ship, canonical spelling first. */
export const REPO_CONFIG_DIRS = [".rove", ".kobe"] as const

/** Every candidate path for `filename`, in precedence order. */
export function repoConfigCandidates(repoDir: string, filename: string): string[] {
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
 * True when `absolutePath` is readable and holds more than whitespace — the
 * single definition of "this candidate counts", so a diagnostic that reports
 * which file wins cannot answer differently from the code that picks it.
 */
export function isNonEmptyRepoFile(absolutePath: string): boolean {
  try {
    return readFileSync(absolutePath, "utf8").trim().length > 0
  } catch {
    return false
  }
}
