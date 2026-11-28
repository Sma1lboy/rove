/**
 * Files-pane `/` search: one query matches file names and file text. Names
 * filter the listing already in memory; text comes from `git grep` over the
 * same tracked + untracked-not-ignored set the All tab lists.
 */

import { unquoteGitPath } from "@sma1lboy/rove-core/lib/git-parsers.ts"
import { runWorktreeGit } from "@sma1lboy/rove-core/worktree/content.ts"
import type { Row } from "./rows"

/** A grep over a huge tree must not pin a subprocess while the user types on. */
export const TEXT_SEARCH_TIMEOUT_MS = 5_000
/** Past this many hits the list is scrolled, not read; more only costs memory. */
export const TEXT_SEARCH_LIMIT = 500

/**
 * Paths whose name contains `query` (case-insensitive). A hit in the file's
 * own name ranks above a hit only in its directories; listing order is kept
 * within each group.
 */
export function matchFileNames(files: readonly string[], query: string): string[] {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return []
  const inName: string[] = []
  const inDir: string[] = []
  for (const path of files) {
    const lower = path.toLowerCase()
    if (!lower.includes(needle)) continue
    const base = lower.slice(lower.lastIndexOf("/") + 1)
    if (base.includes(needle)) inName.push(path)
    else inDir.push(path)
  }
  return [...inName, ...inDir]
}

/** Worktree-relative paths of files whose text contains `query` (literal, case-insensitive). */
export async function grepFileText(worktreePath: string, query: string, signal?: AbortSignal): Promise<string[]> {
  const needle = query.trim()
  if (needle.length === 0) return []
  const result = await runWorktreeGit(
    worktreePath,
    // -I skips binaries; --untracked honours .gitignore, like `listFiles`.
    ["-c", "core.quotePath=false", "grep", "-l", "-I", "-i", "-F", "--untracked", "--full-name", "-e", needle],
    { signal, timeoutMs: TEXT_SEARCH_TIMEOUT_MS },
  )
  // git grep exits 1 when nothing matched; that is an answer, not a failure.
  if (result.status === 1) return []
  if (result.status !== 0) throw new Error((result.stderr ?? "").trim() || "git grep failed")
  const out: string[] = []
  for (const line of (result.stdout ?? "").split("\n")) {
    const path = unquoteGitPath(line.replace(/\r$/, ""))
    if (path.length === 0) continue
    out.push(path)
    if (out.length >= TEXT_SEARCH_LIMIT) break
  }
  return out
}

/** Result rows: name matches first, then files matched only by their text. */
export function searchRows(nameMatches: readonly string[], textMatches: readonly string[]): Row[] {
  const rows: Row[] = nameMatches.map((path) => ({ kind: "file", path, name: path, depth: 0 }))
  const seen = new Set(nameMatches)
  for (const path of textMatches) {
    if (seen.has(path)) continue
    seen.add(path)
    rows.push({ kind: "file", path, name: path, depth: 0, textMatch: true })
  }
  return rows
}
