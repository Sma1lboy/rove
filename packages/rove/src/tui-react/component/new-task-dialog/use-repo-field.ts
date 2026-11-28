/**
 * The Existing tab's folder picker state: selected folder, pure search query,
 * saved/path-browse/folder-browse modes, cursor, and every route that changes the answer.
 *
 * The `<input>` holds ONLY the user's search query (or a pasted/typed path),
 * never the selected repo's name — so opening the picker starts with an empty
 * `Search folders...` box, duplicate basenames never collide, and `selectedRepo`
 * always carries the real canonical path.
 */

import * as os from "node:os"
import { t } from "@sma1lboy/rove-core/i18n/index.ts"
import {
  expandHome,
  filterSubdirs,
  isGitDir,
  joinDrill,
  joinPicked,
  listSubdirs,
  parentDir,
  pathLeaf,
  stripTrailingSlash,
} from "@sma1lboy/rove-core/lib/path-helpers.ts"
import { samePath } from "@sma1lboy/rove-daemon/path-identity"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  BROWSE_BACK_ROW,
  BROWSE_SELECT_HERE_ROW,
  BROWSE_UP_ROW,
  NO_FOLDER,
  OPEN_FOLDER_ROW,
  buildSavedPicker,
  duplicateBasenames,
  initialBrowseDir,
  stripPathQuotes,
} from "../../../tui/component/new-task-dialog/folder-picker"
import {
  type PickerWindow,
  clampCursor,
  computeRepoOptions,
  isRepoPathInput,
  stripNewlines,
  windowAround,
} from "../../../tui/component/new-task-dialog/state"
import { useDerivedDir } from "./use-derived-dir"

export { BROWSE_BACK_ROW, BROWSE_SELECT_HERE_ROW, BROWSE_UP_ROW, NO_FOLDER, OPEN_FOLDER_ROW }

export type FolderPickerMode = "saved" | "path-browse" | "folder-browse"

export type RepoFieldOpts = {
  /** Seeds the selected folder and heads the saved list; `NO_FOLDER` opens on No folder. */
  defaultRepo: string
  /** User-curated repo list (`rove add`). */
  savedRepos: readonly string[]
  /** Rows the picker may paint — the terminal-height budget from the caller. */
  pickerRows: number
  /** Whether the folder picker currently holds focus. */
  focused: boolean
  /** A DIFFERENT repo is now selected (any route). */
  onChanged: () => void
  /** Enter / a click has answered the field with `repo`; move focus along. */
  onAnswered: (repo: string) => void
}

function indexOfSelected(selected: string, items: readonly string[]): number {
  if (!selected) return Math.max(0, items.indexOf(NO_FOLDER))
  const found = items.findIndex((item) => item !== NO_FOLDER && item !== OPEN_FOLDER_ROW && samePath(item, selected))
  return found >= 0 ? found : 0
}

/** Pick initial cursor inside `dir`: highlight `highlightLeaf` if present, else the first subfolder, else `..`/0. */
function browseCursorFor(dir: string, highlightLeaf?: string): number {
  const hasParent = parentDir(dir) !== dir
  const subdirs = filterSubdirs(listSubdirs(dir), "")
  const offset = hasParent ? 1 : 0
  if (highlightLeaf) {
    const idx = subdirs.findIndex((name) => name === highlightLeaf)
    if (idx >= 0) return offset + idx
  }
  return subdirs.length > 0 ? offset : 0
}

export function useRepoField(opts: RepoFieldOpts) {
  const [selectedRepo, setSelectedRepo] = useState(() => opts.defaultRepo.trim())
  const [addedRepos, setAddedRepos] = useState<readonly string[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  // Sync mirror of `searchQuery` so rapid paste/type never lets `h`/`l` key bindings eat chars mid-burst.
  const searchQueryRef = useRef("")
  const [browsingDir, setBrowsingDir] = useState<string | null>(null)
  const [repoPicked, setRepoPicked] = useState(false)

  const repoOptions = useMemo(
    () => computeRepoOptions(opts.defaultRepo, [...addedRepos, ...opts.savedRepos]),
    [opts.defaultRepo, addedRepos, opts.savedRepos],
  )
  const duplicateNames = useMemo(() => duplicateBasenames(repoOptions), [repoOptions])

  const trimmedQuery = searchQuery.trim()
  const mode: FolderPickerMode =
    browsingDir !== null ? "folder-browse" : isRepoPathInput(trimmedQuery) ? "path-browse" : "saved"

  const saved = useMemo(
    () =>
      buildSavedPicker({
        noFolderLabel: t("newTask.noFolder"),
        repoOptions,
        query: mode === "saved" ? searchQuery : "",
      }),
    [repoOptions, mode, searchQuery],
  )

  const [repoCursor, setRepoCursor] = useState(() => indexOfSelected(opts.defaultRepo.trim(), saved.items))

  // Reopen cleanly whenever focus enters the folder chip: empty search box,
  // back on the saved list, cursor resting on the currently selected folder.
  const wasFocused = useRef(opts.focused)
  useEffect(() => {
    if (opts.focused && !wasFocused.current) {
      searchQueryRef.current = ""
      setSearchQuery("")
      setBrowsingDir(null)
      setRepoPicked(false)
      const fresh = buildSavedPicker({
        noFolderLabel: t("newTask.noFolder"),
        repoOptions,
        query: "",
      })
      setRepoCursor(indexOfSelected(selectedRepo, fresh.items))
    }
    wasFocused.current = opts.focused
  }, [opts.focused, repoOptions, selectedRepo])

  // Directory listing for both `path-browse` (typed path) and `folder-browse` (Open folder…).
  const dirInput =
    mode === "folder-browse"
      ? isRepoPathInput(trimmedQuery)
        ? trimmedQuery
        : `${browsingDir}${searchQuery}`
      : mode === "path-browse"
        ? searchQuery
        : ""
  const { split: subdirSplit, filtered: subdirFiltered } = useDerivedDir(dirInput)
  const browseDirBase = mode === "folder-browse" ? subdirSplit.base || browsingDir || "" : subdirSplit.base
  // Hide `..` while actively filtering or pasting a path so row 0 is the matched folder and Enter confirms it.
  const browseHasParent =
    mode === "folder-browse" && !trimmedQuery && browseDirBase !== "" && parentDir(browseDirBase) !== browseDirBase

  const gitDirs = useMemo(() => {
    const out = new Set<string>()
    if (mode === "saved" || !browseDirBase) return out
    for (const name of subdirFiltered) {
      if (isGitDir(`${browseDirBase}${name}`)) out.add(name)
    }
    return out
  }, [mode, browseDirBase, subdirFiltered])

  const browseMiddle = useMemo(
    () => (mode === "folder-browse" ? [...(browseHasParent ? [BROWSE_UP_ROW] : []), ...subdirFiltered] : []),
    [mode, browseHasParent, subdirFiltered],
  )
  const browseItems = useMemo(
    () => (mode === "folder-browse" ? [...browseMiddle, BROWSE_SELECT_HERE_ROW, BROWSE_BACK_ROW] : []),
    [mode, browseMiddle],
  )

  const activeList = mode === "folder-browse" ? browseItems : mode === "path-browse" ? subdirFiltered : saved.items
  const listCap = Math.max(2, opts.pickerRows - 2)

  // Window only the scrollable middle rows so `No folder` / `+ Open folder…` (and
  // `Use this folder` / `← Back` in browse mode) stay pinned visible.
  const recentOffset = saved.showNoFolder ? 1 : 0
  const recentCursor = clampCursor(repoCursor - recentOffset, saved.recent.length)
  const recentWindow: PickerWindow = windowAround(saved.recent, recentCursor, listCap)
  const browseCursor = clampCursor(repoCursor, browseMiddle.length)
  const browseWindow: PickerWindow = windowAround(browseMiddle, browseCursor, listCap)
  const pathBrowseWindow: PickerWindow = windowAround(subdirFiltered, repoCursor, listCap)

  const expandedRepo = selectedRepo ? stripTrailingSlash(expandHome(selectedRepo)) : ""

  function commitSelection(nextPath: string, advance: boolean): void {
    const clean = nextPath === NO_FOLDER ? NO_FOLDER : stripTrailingSlash(expandHome(nextPath.trim()))
    if (clean && !repoOptions.some((r) => samePath(r, clean))) {
      setAddedRepos((prev) => (prev.some((r) => samePath(r, clean)) ? prev : [clean, ...prev]))
    }
    setSelectedRepo(clean)
    searchQueryRef.current = ""
    setSearchQuery("")
    setBrowsingDir(null)
    setRepoPicked(true)
    opts.onChanged()
    if (advance) opts.onAnswered(clean)
  }

  function enterBrowseDir(dir: string, highlightLeaf?: string): void {
    setBrowsingDir(dir)
    searchQueryRef.current = ""
    setSearchQuery("")
    setRepoPicked(false)
    setRepoCursor(browseCursorFor(dir, highlightLeaf))
  }

  function openFolderBrowser(): void {
    const start = initialBrowseDir(selectedRepo, opts.defaultRepo, os.homedir())
    const seed = selectedRepo.trim() || opts.defaultRepo.trim()
    enterBrowseDir(start, seed ? pathLeaf(stripTrailingSlash(seed)) : undefined)
  }

  /** Step back one level (`h` / `←` / `Backspace` on empty input), keeping cursor on the folder we just left. */
  function stepUpBrowse(): boolean {
    if (mode !== "folder-browse" || !browseDirBase) return false
    const up = parentDir(browseDirBase)
    if (up === browseDirBase) return false
    const leftLeaf = pathLeaf(stripTrailingSlash(browseDirBase))
    enterBrowseDir(up, leftLeaf || undefined)
    return true
  }

  /** Step forward one level (`l` / `→` / `Tab`) into the highlighted subfolder (or back on `..`). */
  function stepIntoBrowse(): boolean {
    if (mode !== "folder-browse") return false
    const picked = browseItems[repoCursor]
    if (!picked || picked === BROWSE_SELECT_HERE_ROW || picked === BROWSE_BACK_ROW) return false
    if (picked === BROWSE_UP_ROW) return stepUpBrowse()
    enterBrowseDir(`${browseDirBase}${picked}/`)
    return true
  }

  function exitBrowse(): boolean {
    if (browsingDir === null) return false
    setBrowsingDir(null)
    searchQueryRef.current = ""
    setSearchQuery("")
    const fresh = buildSavedPicker({
      noFolderLabel: t("newTask.noFolder"),
      repoOptions,
      query: "",
    })
    setRepoCursor(indexOfSelected(selectedRepo, fresh.items))
    return true
  }

  function setSearchText(v: string): void {
    const raw = stripNewlines(v)
    const cleaned = isRepoPathInput(stripPathQuotes(raw).trim()) ? stripPathQuotes(raw) : raw
    setRepoPicked(false)
    searchQueryRef.current = cleaned
    setSearchQuery(cleaned)
    setRepoCursor(0)
  }

  function completeRepo(): boolean {
    if (repoPicked) return false
    if (mode === "path-browse") {
      const picked = subdirFiltered[repoCursor]
      if (!picked) {
        // Nothing left to drill: adopt the typed path as the selection before Tab advances.
        if (trimmedQuery) commitSelection(trimmedQuery, false)
        return false
      }
      const next = joinDrill(searchQuery, subdirSplit.base, picked)
      if (next === searchQuery) return false
      setSearchQuery(next)
      setRepoCursor(0)
      return true
    }
    if (mode === "folder-browse") return stepIntoBrowse()
    // Saved mode: Tab completes only while actively filtering a repo; an empty
    // search box lets Tab walk straight on to the next composer chip.
    if (!trimmedQuery) return false
    const picked = saved.items[repoCursor]
    if (picked === undefined || picked === OPEN_FOLDER_ROW) return false
    commitSelection(picked, false)
    return true
  }

  function activateIndex(absoluteIndex: number): void {
    if (mode === "path-browse") {
      const picked = subdirFiltered[absoluteIndex]
      if (picked) {
        commitSelection(joinPicked(searchQuery, subdirSplit.base, picked), true)
        return
      }
      if (trimmedQuery) {
        commitSelection(trimmedQuery, true)
      }
      return
    }
    if (mode === "folder-browse") {
      const picked = browseItems[absoluteIndex]
      if (picked === undefined) {
        if (isRepoPathInput(trimmedQuery)) commitSelection(trimmedQuery, true)
        return
      }
      if (picked === BROWSE_UP_ROW) {
        stepUpBrowse()
        return
      }
      if (picked === BROWSE_SELECT_HERE_ROW) {
        if (browseDirBase) commitSelection(browseDirBase, true)
        return
      }
      if (picked === BROWSE_BACK_ROW) {
        exitBrowse()
        return
      }
      // Enter confirms the highlighted folder directly (`l` / `→` / `Tab` drills into subfolders).
      commitSelection(`${browseDirBase}${picked}`, true)
      return
    }
    const picked = saved.items[absoluteIndex]
    if (picked === undefined) return
    if (picked === OPEN_FOLDER_ROW) {
      openFolderBrowser()
      return
    }
    commitSelection(picked, true)
  }

  function onRepoSubmit(): void {
    activateIndex(repoCursor)
  }

  function selectRepoAt(absoluteIndex: number): void {
    setRepoCursor(absoluteIndex)
    activateIndex(absoluteIndex)
  }

  function moveRepoCursor(delta: 1 | -1): void {
    if (activeList.length === 0) return
    setRepoCursor((c) => clampCursor(c + delta, activeList.length))
  }

  function reopenPicker(): void {
    setRepoPicked(false)
  }

  return {
    /** Selected canonical repo path (or `""` for No folder). */
    repo: selectedRepo,
    searchQuery,
    isSearchEmpty: () => searchQueryRef.current === "",
    browsingDir,
    browseDirBase,
    mode,
    repoOptions,
    duplicateNames,
    showNoFolder: saved.showNoFolder,
    recentOffset,
    recentWindow,
    browseWindow,
    browseMiddleLength: browseMiddle.length,
    pathBrowseWindow,
    gitDirs,
    activeList,
    repoCursor,
    repoPicked,
    expandedRepo,
    setSearchText,
    openFolderBrowser,
    stepUpBrowse,
    stepIntoBrowse,
    exitBrowse,
    completeRepo,
    onRepoSubmit,
    selectRepoAt,
    moveRepoCursor,
    reopenPicker,
  }
}
