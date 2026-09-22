/**
 * The new-task dialog's repo field vocabulary: it shows a repo NAME, downstream
 * needs a PATH, and the translation (plus what Tab completes toward) lives
 * here; `state.ts` owns focus/list/cursor.
 *
 * It's a translation, not a rendering: an opentui `<input>` adopts its `value`
 * prop as the edit buffer, so displaying `quokka` while state held the full
 * path wrote the short string back on the next keystroke and the two
 * oscillated.
 *
 * Framework-free, side-effect-free, no fs or git. May import `path-helpers`,
 * never the reverse — which is why Tab completion lives here.
 */

import { samePath } from "@sma1lboy/kobe-daemon/path-identity"
import { joinDrill } from "../../lib/path-helpers"
import { type PickerMode, isRepoPathInput, splitRepoRow } from "./state"

/**
 * Display split for a RESOLVED repo value: name first, directory handed back to
 * paint muted at the right edge (as {@link splitRepoRow} does for picker rows).
 * The field still holds a path — every consumer needs one, and with many repos
 * under one parent a basename alone isn't unique; the visible dir keeps
 * same-named repos apart.
 *
 * An unresolved (still-typed) value comes back verbatim with empty `dir`:
 * rewriting a half-typed path under the cursor would contradict the keystrokes.
 */
export function splitRepoInput(value: string, resolved: boolean): { name: string; dir: string } {
  if (!resolved) return { name: value, dir: "" }
  const { base, dir } = splitRepoRow(value.trim())
  return { name: base, dir }
}

/**
 * What a field value means at submit time (the field holds names, so a bare
 * name must turn back into a path):
 *   - `path` — already a path (separator or `~`), or names exactly one known repo.
 *   - `ambiguous` — several known repos share that basename; picking the first
 *     would silently open the wrong repo, so the caller sends the user back.
 *   - `path` with the raw text — unknown name, left for `validateRepoPath` to
 *     report "does not exist" in its own words.
 */
export type RepoResolution =
  | { kind: "path"; path: string }
  | { kind: "ambiguous"; name: string; matches: readonly string[] }

export function resolveRepoInput(value: string, repoOptions: readonly string[]): RepoResolution {
  const trimmed = value.trim()
  // Same path-vs-query test `pickerModeFor` uses.
  if (!trimmed || isRepoPathInput(trimmed)) return { kind: "path", path: trimmed }
  const matches = repoOptions.filter((p) => splitRepoRow(p).base === trimmed)
  if (matches.length === 1) return { kind: "path", path: matches[0] as string }
  if (matches.length > 1) return { kind: "ambiguous", name: trimmed, matches }
  return { kind: "path", path: trimmed }
}

/**
 * The name when it resolves back to this exact path, else the whole path — a
 * shared or unsaved basename identifies nothing.
 */
export function nameOrPath(path: string, repoOptions: readonly string[]): string {
  const name = splitRepoInput(path, true).name
  const back = resolveRepoInput(name, repoOptions)
  return back.kind === "path" && samePath(back.path, path) ? name : path
}

/**
 * Tab completes the highlighted suggestion in place; `null` = nothing left, so
 * Tab falls through to moving to the next field (shell semantics).
 *   - `browse` rows are subdirectories: step DOWN (`joinDrill`'s trailing slash
 *     re-points the picker), dropdown stays open so the next Tab goes deeper.
 *   - `saved` rows are whole repos: end of the road, dropdown closes.
 * Pure — the caller passes the highlighted row and `baseExpanded` (from
 * `splitPathForDirSuggest`).
 */
export type RepoCompletion = { value: string; collapse: boolean }

export function completeRepoInput(args: {
  value: string
  mode: PickerMode
  highlighted: string | undefined
  baseExpanded: string
  repoOptions: readonly string[]
}): RepoCompletion | null {
  const { value, mode, highlighted, baseExpanded, repoOptions } = args
  if (!highlighted) return null
  if (mode === "browse") {
    const next = joinDrill(value, baseExpanded, highlighted)
    return next === value ? null : { value: next, collapse: false }
  }
  const next = nameOrPath(highlighted, repoOptions)
  return next === value.trim() ? null : { value: next, collapse: true }
}
