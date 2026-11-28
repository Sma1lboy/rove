/**
 * Pure list/section helpers for the New task folder picker popover:
 *   - Search box filters `No folder` + `Recent` saved folders; `Open folder…` stays pinned at bottom.
 *   - Basenames stay clean unless two saved folders share a name, in which case their parent dir disambiguates.
 *   - Framework-free, side-effect-free, no fs.
 */

import { pathSyntax } from "@sma1lboy/rove-daemon/path-identity"
import { filterRepos, splitRepoRow } from "./state"

/** Sentinel row key for a session in no folder. */
export const NO_FOLDER = ""
/** Sentinel row key for the pinned "Open folder…" action at the bottom of Saved mode. */
export const OPEN_FOLDER_ROW = "\0open-folder"
/** Sentinel row key for ".." (parent folder) inside the folder browser. */
export const BROWSE_UP_ROW = "\0browse-up"
/** Sentinel row key for selecting the directory currently open in the folder browser. */
export const BROWSE_SELECT_HERE_ROW = "\0browse-select-here"
/** Sentinel row key for returning from the folder browser to saved folders. */
export const BROWSE_BACK_ROW = "\0browse-back"

/** Lowercase basenames shared by 2+ saved folders (the only rows that need a parent dir beside them). */
export function duplicateBasenames(repos: readonly string[]): ReadonlySet<string> {
  const counts = new Map<string, number>()
  for (const repo of repos) {
    const base = splitRepoRow(repo).base.toLowerCase()
    counts.set(base, (counts.get(base) ?? 0) + 1)
  }
  const dupes = new Set<string>()
  for (const [base, n] of counts) {
    if (n > 1) dupes.add(base)
  }
  return dupes
}

/** Starting directory for `Open folder…`: parent of the active/default folder (lists siblings), else home. */
export function initialBrowseDir(selectedRepo: string, defaultRepo: string, homeDir: string): string {
  const seed = selectedRepo.trim() || defaultRepo.trim()
  if (seed) {
    const { dir } = splitRepoRow(seed)
    if (dir) return dir
  }
  const sep = pathSyntax(homeDir).sep
  if (!homeDir) return sep
  return homeDir.endsWith(sep) ? homeDir : `${homeDir}${sep}`
}

export type SavedPickerModel = {
  readonly showNoFolder: boolean
  readonly recent: readonly string[]
  /** Flat keyboard navigation order: [No folder?, ...recent, Open folder…]. */
  readonly items: readonly string[]
}

/** Build the Saved-mode sections and flat navigation list for a search query. */
export function buildSavedPicker(opts: {
  noFolderLabel: string
  repoOptions: readonly string[]
  query: string
}): SavedPickerModel {
  const q = opts.query.trim().toLowerCase()
  const showNoFolder = !q || opts.noFolderLabel.toLowerCase().includes(q)
  const recent = filterRepos(opts.repoOptions, q)
  const items: string[] = [...(showNoFolder ? [NO_FOLDER] : []), ...recent, OPEN_FOLDER_ROW]
  return { showNoFolder, recent, items }
}
