/**
 * The Existing tab's repo cluster — the question "WHICH repository", start to
 * finish. Sibling of `./use-branch-field.ts` (which ref it forks from) and of
 * `./use-clone-state.ts` / `./use-adopt-state.ts`.
 *
 * The seam: everything about identifying a repo lives here — the field's
 * text, what that text resolves to, both suggestion lists behind it, the
 * cursor over them, and every route that changes the answer (typing, Tab
 * completion, Enter, a click). `./view-model.ts` keeps what is ABOUT the
 * dialog rather than about the repo: tabs, engine, intent, commit dispatch
 * and key bindings.
 *
 * The field holds exactly what it shows — a NAME once one is chosen, free
 * text while it is being typed — and never a display derived from some other
 * value: an opentui `<input>` adopts its `value` prop as its edit buffer, so
 * a field showing one string while state holds another writes the shown one
 * back on the next keystroke and the two oscillate. One representation,
 * translated to a path at the boundaries (`repo-field.ts`) instead.
 */

import { useMemo, useState } from "react"
import {
  type RepoResolution,
  completeRepoInput,
  nameOrPath,
  resolveRepoInput,
  splitRepoInput,
} from "../../../tui/component/new-task-dialog/repo-field"
import {
  type PickerWindow,
  clampCursor,
  computeRepoOptions,
  filterRepos,
  pickerModeFor,
  stripNewlines,
  windowAround,
} from "../../../tui/component/new-task-dialog/state"
import { expandHome, joinPicked, stripTrailingSlash } from "../../../tui/lib/path-helpers"
import { useDerivedDir } from "./use-derived-dir"

export type RepoFieldOpts = {
  /** The caller's cwd — seeds the field and heads the saved list. */
  defaultRepo: string
  /** User-curated repo list (`/add-repo`). */
  savedRepos: readonly string[]
  /** Rows the picker may paint — the terminal-height budget from the caller. */
  pickerRows: number
  /** A DIFFERENT repo is now in the field (any route). */
  onChanged: () => void
  /** Enter / a click has answered the field; move focus along. */
  onAnswered: () => void
}

export function useRepoField(opts: RepoFieldOpts) {
  // Seeded from the caller's PATH, shown as a name — the field's own grammar
  // from the first frame rather than a path that turns into a name on first
  // touch. `repoDir` puts the directory back beside it. Same round-trip guard
  // as `pickRepo`: a basename shared with another saved repo would open the
  // dialog on an ambiguous value, so that case keeps the path.
  const [repo, setRepo] = useState(() =>
    nameOrPath(opts.defaultRepo, computeRepoOptions(opts.defaultRepo, opts.savedRepos)),
  )
  const [repoCursor, setRepoCursor] = useState(0)
  // "Selected, not drilled" latch — collapses the suggestion dropdown after
  // Enter/click; typing resumes browsing.
  const [repoPicked, setRepoPicked] = useState(false)

  const repoOptions = useMemo(
    () => computeRepoOptions(opts.defaultRepo, opts.savedRepos),
    [opts.defaultRepo, opts.savedRepos],
  )
  const mode = pickerModeFor(repo, repoOptions)
  const repoResolution: RepoResolution = resolveRepoInput(repo, repoOptions)
  // The directory the chosen NAME resolves to — muted, at the row's right
  // edge, so a bare name still says where it is. Empty whenever the field
  // already holds a path: the directory is then in the field itself, and
  // repeating it beside it would print the same string twice.
  const repoDir =
    repoResolution.kind === "path" && repoResolution.path !== repo.trim()
      ? splitRepoInput(repoResolution.path, true).dir
      : ""
  const { split: subdirSplit, filtered: subdirFiltered } = useDerivedDir(repo)
  const savedFiltered = useMemo(() => filterRepos(repoOptions, repo), [repoOptions, repo])
  const activeList = mode === "browse" ? subdirFiltered : savedFiltered
  const activeWindow: PickerWindow = windowAround(activeList, repoCursor, opts.pickerRows)

  // Everything downstream (branch list, validation, adopt scan, the submitted
  // `repo`) needs a PATH, and the field holds a name — so resolve first, then
  // expand. An ambiguous name resolves to nothing until the user disambiguates.
  // …and normalized: Tab-completing a directory leaves the walking slash in
  // the FIELD on purpose (it is what keeps the picker pointed at the
  // children), so this is where that slash stops travelling.
  const expandedRepo = repoResolution.kind === "path" ? stripTrailingSlash(expandHome(repoResolution.path)) : ""

  /**
   * The repo changed — by ANY route (typing, Tab, Enter on the picker, a
   * click). Every write to the field goes through here, because the caller
   * hangs per-repo state off `onChanged` (the intent row) and a call site
   * setting `repo` directly would leave that state asserting the previous
   * repo.
   */
  function changeRepo(next: string): void {
    setRepo(next)
    opts.onChanged()
  }

  /**
   * A repo was PICKED (dropdown Enter, click, browse-mode select) — the
   * picker deals in paths, the field holds names, and this is the one funnel
   * every selection route already goes through, so the conversion lives here.
   */
  function pickRepo(path: string): void {
    changeRepo(nameOrPath(path, repoOptions))
  }

  function setRepoText(v: string): void {
    setRepoPicked(false)
    changeRepo(stripNewlines(v))
    setRepoCursor(0)
  }

  /**
   * Tab — shell completion, not field advance. Returns whether it consumed
   * the key.
   *
   * The guard is the picker's own render condition (`tab-existing.tsx`): Tab
   * only completes toward something the user can SEE, so a collapsed or empty
   * dropdown leaves the key its old meaning and focus moves on. That is also
   * what makes the SECOND Tab advance — the first collapses a saved pick, and
   * a browse walk ends when the typed path names a directory with nothing
   * left to offer.
   */
  function completeRepo(): boolean {
    if (repoPicked) return false
    const done = completeRepoInput({
      value: repo,
      mode,
      highlighted: activeList[repoCursor],
      baseExpanded: subdirSplit.base,
      repoOptions,
    })
    if (!done) return false
    changeRepo(done.value)
    setRepoPicked(done.collapse)
    setRepoCursor(0)
    return true
  }

  // Enter on the repo field — pure selection, never commits.
  function onRepoSubmit(): void {
    if (!repo.trim() && mode === "saved") {
      const picked = activeList[0]
      if (picked) {
        pickRepo(picked)
        opts.onAnswered()
        return
      }
    }
    if (mode === "browse") {
      const picked = subdirFiltered[repoCursor]
      if (picked) {
        // Enter = SELECT this dir as the repo and advance (no drill — that is
        // Tab's job, and the two keys stay different on purpose).
        pickRepo(joinPicked(repo, subdirSplit.base, picked))
        setRepoCursor(0)
        setRepoPicked(true)
      }
      opts.onAnswered()
      return
    }
    const picked = activeList[repoCursor]
    if (picked) pickRepo(picked)
    opts.onAnswered()
  }

  function selectRepoAt(absoluteIndex: number): void {
    const picked = activeList[absoluteIndex]
    if (!picked) return
    if (mode === "browse") {
      pickRepo(joinPicked(repo, subdirSplit.base, picked))
      setRepoPicked(true)
    } else {
      pickRepo(picked)
    }
    setRepoCursor(absoluteIndex)
    opts.onAnswered()
  }

  function moveRepoCursor(delta: 1 | -1): void {
    if (activeList.length === 0) return
    setRepoCursor((c) => clampCursor(c + delta, activeList.length))
  }

  /** An ambiguous name was refused at submit — put the list back on screen,
   *  where the directories that tell the matches apart are visible. */
  function reopenPicker(): void {
    setRepoPicked(false)
  }

  return {
    repo,
    repoDir,
    repoOptions,
    repoResolution,
    mode,
    activeList,
    activeWindow,
    repoCursor,
    repoPicked,
    expandedRepo,
    setRepoText,
    completeRepo,
    onRepoSubmit,
    selectRepoAt,
    moveRepoCursor,
    reopenPicker,
  }
}
