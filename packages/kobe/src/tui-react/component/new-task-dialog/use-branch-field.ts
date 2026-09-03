/**
 * The existing tab's "from branch" cluster — the dialog's OTHER picker,
 * sibling to `./use-clone-state.ts` and `./use-adopt-state.ts`.
 *
 * The seam: `./view-model.ts` owns which repo you are talking about; this
 * hook owns which ref that repo forks from. The dependency runs one way —
 * the branch list is a function of the resolved repo path, and nothing here
 * is read back to decide the repo — so the whole cluster (the ref text, its
 * "touched" latch, the filtered branch list, its cursor and window, and the
 * Enter-commits behavior of the tab's last field) travels together and
 * leaves the view-model with tabs, engine, repo and commit dispatch.
 *
 * `listLocalBranches` / `getCurrentBranch` are the sync git snapshots from
 * `src/tui/lib/git-snapshot.ts`, memoized on the expanded repo path.
 */

import { useEffect, useMemo, useState } from "react"
import {
  type PickerWindow,
  clampCursor,
  filterBranches,
  resolveBaseRef,
  stripNewlines,
  windowAround,
} from "../../../tui/component/new-task-dialog/state"
import { DEFAULT_BASE_REF, getCurrentBranch, listLocalBranches } from "../../../tui/lib/git-snapshot"
import { expandHome } from "../../../tui/lib/path-helpers"

export type BranchFieldOpts = {
  /** Absolute repo path the branch list is read from; "" while unresolved. */
  expandedRepo: string
  /** Rows the picker may paint — the terminal-height budget from the caller. */
  pickerRows: number
  /** Seeds the ref before any repo is resolved (the caller's cwd). */
  defaultRepo: string
  /** Enter on this field is the tab's last stop: resolve, then create. */
  commit: () => void
  /** Focus lands on Create once a branch is clicked out of the picker. */
  onPicked: () => void
}

export function useBranchField(opts: BranchFieldOpts) {
  // Initial baseRef tracks the cwd's current branch (a worktree forked from a
  // feature branch defaults to it, not a hardcoded "main").
  const [baseRef, setBaseRef] = useState(
    () => getCurrentBranch(expandHome(opts.defaultRepo.trim())) ?? DEFAULT_BASE_REF,
  )
  // Once the user has typed here we stop auto-syncing from the repo's current
  // branch — the manual override wins.
  const [baseRefTouched, setBaseRefTouched] = useState(false)
  const [branchCursor, setBranchCursor] = useState(0)

  const branches = useMemo(() => listLocalBranches(opts.expandedRepo), [opts.expandedRepo])
  const branchFiltered = useMemo(() => filterBranches(branches, baseRef), [branches, baseRef])
  const branchWindow: PickerWindow = windowAround(branchFiltered, branchCursor, opts.pickerRows)

  // Auto-sync baseRef to the picked repo's current branch until touched.
  useEffect(() => {
    if (!opts.expandedRepo || baseRefTouched) return
    const current = getCurrentBranch(opts.expandedRepo)
    if (current) setBaseRef(current)
  }, [opts.expandedRepo, baseRefTouched])

  function setBaseRefText(v: string): void {
    setBaseRefTouched(true)
    setBaseRef(stripNewlines(v))
    setBranchCursor(0)
  }

  function pickBranchAt(absoluteIndex: number): void {
    const name = branchFiltered[absoluteIndex]
    if (!name) return
    setBaseRef(name)
    setBaseRefTouched(true)
    setBranchCursor(absoluteIndex)
    opts.onPicked()
  }

  // Last field on the existing tab — Enter resolves the highlighted branch
  // and creates straight away.
  function onBaseRefSubmit(): void {
    setBaseRef(resolveBaseRef(baseRef, branchFiltered, branchCursor))
    setBaseRefTouched(true)
    opts.commit()
  }

  function moveBranchCursor(delta: 1 | -1): void {
    if (branchFiltered.length === 0) return
    setBranchCursor((c) => clampCursor(c + delta, branchFiltered.length))
  }

  /** A repo change invalidates the highlight — the list underneath changed. */
  function resetBranchCursor(): void {
    setBranchCursor(0)
  }

  return {
    baseRef,
    branches,
    branchFiltered,
    branchWindow,
    branchCursor,
    setBaseRefText,
    pickBranchAt,
    onBaseRefSubmit,
    moveBranchCursor,
    resetBranchCursor,
  }
}
