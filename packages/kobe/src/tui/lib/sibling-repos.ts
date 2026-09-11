/**
 * Which repos exist BESIDE the ones Rove already knows about.
 *
 * The new-task dialog used to offer only `savedRepos` — the list a user had
 * built one `rove add` (or one created task) at a time. Opening the dialog on
 * a fresh install therefore showed nothing to pick, and typing the name of a
 * checkout sitting right next to a saved one failed as "path does not
 * exist". But a person's repos cluster: `~/Projects/*`, `~/i/*`, one or two
 * parents hold nearly all of them. Knowing ONE repo is enough to know where
 * the rest live, the way an editor's "open project" list is the directory,
 * not a curated set.
 *
 * Filesystem only — `readdirSync` and an `existsSync` on `.git` per entry —
 * so it stays off the render-path sync-subprocess guard and costs
 * milliseconds for a parent with a hundred entries. It runs once when the
 * dialog is opened (`task-create-flow.ts`), not per keystroke.
 */

import * as fs from "node:fs"
import * as path from "node:path"
import { looksLikeGitRepo } from "./path-helpers"

/**
 * The nearest git checkout root at or above `p` — walking up until a
 * directory holds a `.git` entry — or `null` when nothing above it does.
 *
 * The dialog's default repo is the process cwd when nothing else is known,
 * and a cwd is often a SUBDIRECTORY of a repo (`rove/packages/kobe`). Its
 * parent is then `rove/packages/`, which holds no sibling repos at all; the
 * repo root's parent (`~/Projects/`) is the one that does. Pure fs walk, no
 * `git rev-parse`, so it cannot canonicalize symlinks — it does not need to,
 * the answer only seeds a directory listing.
 */
export function nearestGitRoot(p: string): string | null {
  let cur = path.resolve(p)
  for (;;) {
    if (looksLikeGitRepo(cur)) return cur
    const up = path.dirname(cur)
    if (up === cur) return null
    cur = up
  }
}

/**
 * Git checkouts found in the parent directories of `known` repos, as
 * absolute paths, in parent order then name order. Hidden entries are
 * skipped, and so is anything that is not a directory or has no `.git`.
 *
 * The `known` repos themselves come back too when they sit in a scanned
 * parent — the caller dedupes against the saved list (`computeRepoOptions`
 * already does), and dropping them here would just mean keeping two
 * definitions of "already listed" in sync. A `known` entry that is not an
 * absolute local path (a `~/` spelling, a remote `ssh://` key, a bare name)
 * contributes no parent: it cannot be listed, and resolving it is the
 * dialog's job, not this scan's.
 */
export function discoverSiblingRepos(known: readonly string[]): readonly string[] {
  const parents: string[] = []
  const seen = new Set<string>()
  for (const k of known) {
    const trimmed = k.trim()
    if (!path.isAbsolute(trimmed)) continue
    const parent = path.dirname(trimmed)
    if (parent === trimmed || seen.has(parent)) continue
    seen.add(parent)
    parents.push(parent)
  }
  const out: string[] = []
  for (const parent of parents) {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(parent, { withFileTypes: true })
    } catch {
      continue
    }
    const names = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b))
    for (const name of names) {
      const full = path.join(parent, name)
      if (looksLikeGitRepo(full)) out.push(full)
    }
  }
  return out
}
