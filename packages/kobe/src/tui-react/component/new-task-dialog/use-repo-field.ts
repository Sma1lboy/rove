/**
 * The Existing tab's "WHICH repository" field: text, resolution, both
 * suggestion lists, cursor, and every route that changes the answer.
 *
 * The field holds exactly what it shows (a NAME once chosen, free text while
 * typing), never a derived display: an opentui `<input>` adopts `value` as
 * its edit buffer, so showing one string while state holds another writes the
 * shown one back and they oscillate. Paths are derived at the boundaries
 * (`repo-field.ts`).
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
  // Seeded from the caller's PATH, shown as a name from the first frame. A
  // basename shared with another saved repo would be ambiguous, so that case
  // keeps the path.
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
  // The chosen NAME's directory, shown beside it. Empty when the field holds
  // a path — it'd print the same string twice.
  const repoDir =
    repoResolution.kind === "path" && repoResolution.path !== repo.trim()
      ? splitRepoInput(repoResolution.path, true).dir
      : ""
  const { split: subdirSplit, filtered: subdirFiltered } = useDerivedDir(repo)
  const savedFiltered = useMemo(() => filterRepos(repoOptions, repo), [repoOptions, repo])
  const activeList = mode === "browse" ? subdirFiltered : savedFiltered
  const activeWindow: PickerWindow = windowAround(activeList, repoCursor, opts.pickerRows)

  // Downstream needs a PATH: resolve, expand, and strip the trailing slash
  // Tab-completion leaves in the FIELD on purpose (it keeps the picker on the
  // children). An ambiguous name resolves to "".
  const expandedRepo = repoResolution.kind === "path" ? stripTrailingSlash(expandHome(repoResolution.path)) : ""

  /** Every write to the field goes through here: the caller hangs per-repo
   *  state off `onChanged`, which a direct `setRepo` would leave stale. */
  function changeRepo(next: string): void {
    setRepo(next)
    opts.onChanged()
  }

  /** Every pick route funnels here: the picker deals in paths, the field in
   *  names. */
  function pickRepo(path: string): void {
    changeRepo(nameOrPath(path, repoOptions))
  }

  function setRepoText(v: string): void {
    setRepoPicked(false)
    changeRepo(stripNewlines(v))
    setRepoCursor(0)
  }

  /**
   * Tab = shell completion; returns whether it consumed the key. Guarded by
   * the picker's render condition (`tab-existing.tsx`): it only completes
   * toward something VISIBLE, so a collapsed/empty dropdown lets focus move
   * on — which is what makes the second Tab advance.
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
        // Enter selects and advances; drilling is Tab's job.
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
