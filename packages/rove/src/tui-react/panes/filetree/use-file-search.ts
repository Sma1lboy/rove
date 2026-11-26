/**
 * Files-pane `/` search state: the query (shared capture with the sidebar's
 * search row), name matches over the in-memory listing, and a debounced,
 * abortable `git grep` for text matches.
 */

import { useEffect, useMemo, useState } from "react"
import type { Row } from "../../../tui/panes/filetree/rows"
import { grepFileText, matchFileNames, searchRows } from "../../../tui/panes/filetree/search"
import { type TreeSearch, useTreeSearch } from "../sidebar/use-tree-search"

/** Long enough that a typed word spawns one grep, not one per letter. */
const TEXT_SEARCH_DEBOUNCE_MS = 150

export interface FileSearch extends TreeSearch {
  /** The trimmed query has text, so results replace the tree. */
  readonly filtering: boolean
  readonly rows: readonly Row[]
  /** The text search for the current query has not answered yet. */
  readonly textPending: boolean
}

export function useFileSearch(opts: {
  readonly focused: boolean
  readonly worktreePath: string | null
  /** Another machine's worktree: names only, its text is not on this disk. */
  readonly remote: boolean
  readonly files: readonly string[] | null
}): FileSearch {
  const search = useTreeSearch({ focused: opts.focused })
  const needle = search.active ? search.query.trim() : ""
  const [text, setText] = useState<{ readonly query: string; readonly paths: readonly string[] } | null>(null)

  useEffect(() => {
    setText(null)
    const path = opts.worktreePath
    if (needle.length === 0 || path == null || opts.remote) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      grepFileText(path, needle, controller.signal)
        .then((paths) => {
          if (!controller.signal.aborted) setText({ query: needle, paths })
        })
        // A failed or timed-out grep leaves the name matches standing.
        .catch(() => {
          if (!controller.signal.aborted) setText({ query: needle, paths: [] })
        })
    }, TEXT_SEARCH_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [needle, opts.worktreePath, opts.remote])

  const names = useMemo(
    () => (needle.length === 0 ? [] : matchFileNames(opts.files ?? [], needle)),
    [needle, opts.files],
  )
  const textPaths = text?.query === needle ? text.paths : null
  const rows = useMemo(() => searchRows(names, textPaths ?? []), [names, textPaths])

  return {
    ...search,
    filtering: needle.length > 0,
    rows,
    textPending: needle.length > 0 && !opts.remote && opts.worktreePath != null && textPaths == null,
  }
}
