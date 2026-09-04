/**
 * What the text in the new-task dialog's repo FIELD means.
 *
 * Split from `state.ts` because it answers a different question. `state.ts` is
 * the dialog's reducer layer — which field has focus, which list is open,
 * where the cursor sits. This file is the field's own vocabulary: the input
 * shows a repo NAME, everything downstream needs a PATH, and the translation
 * between them — plus what Tab completes toward — lives here.
 *
 * The reason it is a translation and not a rendering: an opentui `<input>`
 * adopts its `value` prop as the text it edits, so a field displaying
 * `quokka` while state held `/Users/me/i/quokka` wrote the short string back
 * on the next keystroke and the two oscillated. The field really does hold a
 * name; the conversion happens at the boundaries, here.
 *
 * Same rules as `state.ts`: framework-free, side-effect-free, no fs of its
 * own, no git. `joinDrill` is imported for its string arithmetic only — this
 * file may lean on `path-helpers`, never the reverse, which is why the Tab
 * completion (it needs `nameOrPath` too) lands here rather than beside it.
 */

import { joinDrill } from "../../lib/path-helpers"
import { type PickerMode, splitRepoRow } from "./state"

/**
 * How the repo INPUT should render a value: the repo's name, and the
 * directory that merely locates it.
 *
 * The field still HOLDS a path. Everything downstream needs one —
 * `validateRepoPath`, `listLocalBranches`, `getCurrentBranch`, the adopt
 * scan and the submitted `repo` all take a path — and with a hundred repos
 * flat under one parent a basename does not identify a repo on its own.
 * What changes is what the field SHOWS: once the value is a RESOLVED repo
 * it leads with the name and hands the directory back for the row to paint
 * muted at the right edge, the same split {@link splitRepoRow} gives the
 * picker rows. Two repos sharing a basename stay tellable apart because
 * that directory is on screen beside the name, not because the name is
 * unique.
 *
 * A value the user is still typing is NOT resolved and comes back verbatim
 * with an empty `dir` — rewriting a half-typed path under the cursor would
 * leave the field disagreeing with the keystrokes that produced it, and
 * typing a path is still how you reach a repo the saved list has never seen.
 */
export function splitRepoInput(value: string, resolved: boolean): { name: string; dir: string } {
  if (!resolved) return { name: value, dir: "" }
  const { base, dir } = splitRepoRow(value.trim())
  return { name: base, dir }
}

/**
 * What a repo field value MEANS at submit time.
 *
 * The field is an editing buffer, not a display: an opentui `<input>` adopts
 * its `value` prop as the text it edits, so a field showing `quokka` sends
 * back `quokka` + the keystroke, never the path it was derived from. Showing
 * names therefore means the field really does hold names, and a bare name has
 * to be turned back into a path before anything downstream can use it.
 *
 * Three answers, because a name is not always an answer:
 *   - `path` — the value already IS a path (contains a separator, or `~`), or
 *     it names exactly one known repo. This is the ordinary case.
 *   - `ambiguous` — several known repos share that basename. With a hundred
 *     repos flat under one parent this is routine, and picking the
 *     alphabetically-first one would silently open the wrong repo, so the
 *     caller must send the user back to the list instead of guessing.
 *   - `path` with the raw text — an unknown name. Left alone so
 *     `validateRepoPath` produces its own "path does not exist" rather than
 *     this layer inventing a second vocabulary for the same failure.
 */
export type RepoResolution =
  | { kind: "path"; path: string }
  | { kind: "ambiguous"; name: string; matches: readonly string[] }

export function resolveRepoInput(value: string, repoOptions: readonly string[]): RepoResolution {
  const trimmed = value.trim()
  // Anything path-shaped is already the answer — the same test `pickerModeFor`
  // uses to decide it is looking at a path rather than a query.
  if (!trimmed || trimmed.includes("/") || trimmed.startsWith("~")) return { kind: "path", path: trimmed }
  const matches = repoOptions.filter((p) => splitRepoRow(p).base === trimmed)
  if (matches.length === 1) return { kind: "path", path: matches[0] as string }
  if (matches.length > 1) return { kind: "ambiguous", name: trimmed, matches }
  return { kind: "path", path: trimmed }
}

/**
 * What the repo FIELD should hold for a given path: its name when that name
 * resolves back to this very path, the whole path otherwise.
 *
 * The point of showing a name is that it identifies the repo. A basename
 * shared with another saved repo resolves to `ambiguous` and a name outside
 * the saved list resolves to itself — in both cases the name identifies
 * nothing, so the path stays and keeps doing the job.
 */
export function nameOrPath(path: string, repoOptions: readonly string[]): string {
  const name = splitRepoInput(path, true).name
  const back = resolveRepoInput(name, repoOptions)
  return back.kind === "path" && back.path === path ? name : path
}

/**
 * What Tab should put in the field: the highlighted suggestion, completed
 * IN PLACE, or `null` when there is nothing left to complete.
 *
 * `null` is the reason this returns an option rather than a string — it is
 * what hands Tab back to its other job. One Tab completes; the next one,
 * with nothing more to say, moves to the next field. That is the shell
 * bargain: the key means "finish this for me", and finishing nothing means
 * finishing the field.
 *
 * The two modes complete toward different things, because their rows are
 * different kinds of answer:
 *   - `browse` rows are subdirectories, so the completion is a step DOWN —
 *     `joinDrill`'s trailing slash re-points the picker at the new
 *     directory's children and the next Tab walks one level deeper. The
 *     dropdown has to STAY open or the walk ends after one step.
 *   - `saved` rows are whole repos: nothing lives under them, so the name is
 *     the end of the road and the dropdown closes behind it.
 *
 * Pure — the caller passes the highlighted row and the directory it was read
 * from (`baseExpanded`, what `splitPathForDirSuggest` gave the picker), so no
 * fs work happens here.
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
