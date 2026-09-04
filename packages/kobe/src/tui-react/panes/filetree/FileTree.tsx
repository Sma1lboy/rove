/** @jsxImportSource @opentui/react */
/**
 * File tree pane. The behavior lives in the shared framework-free logic
 * (`git.ts`, `rows.ts`, `pane-core.ts`, `keys-core.ts`, `open-external.ts`);
 * this file owns only the React reactivity, following THE ASYNC CANON from
 * `src/tui-react/history/host.tsx`:
 *
 *   - each async git read is `useState` + a dependency-keyed `useEffect`;
 *   - the last resolved value stays visible while a refresh is in flight;
 *   - stale completions are dropped (AbortController + fetch sequence);
 *   - the opt-in fs watch bumps a `refreshTick` scalar the data effect
 *     refetches from, instead of owning its own fetch.
 *
 * Three fetch effects: worktree change (wipe + reload), tab change
 * (cache-first + cursor reset), and refresh tick (cursor-preserving reload).
 * Content-equality setters (`sameFileList` / `sameStatusEntries`) keep
 * no-change refreshes from re-rendering — see rows.ts for why renderable
 * churn matters here.
 */

import { errorMessage } from "@/lib/error-message"
import type { ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/react"
import { readRoveEnv } from "@sma1lboy/kobe-daemon/compat-env"
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react"
import {
  type GitScope,
  type StatusEntry,
  listFiles,
  resolveBase,
  statusFiles,
  statusFilesBranch,
} from "../../../tui/panes/filetree/git"
import { type FileTreeTab, fileTreeBindings } from "../../../tui/panes/filetree/keys-core"
import { openExternally } from "../../../tui/panes/filetree/open-external"
import {
  type NavAction,
  collapseOrParentAction,
  computePathBudget,
  computeStatWidths,
  expandOrDescendAction,
  followScrollTop,
  gitErrorIsRetryable,
  summarizeGitError,
  toggleDir,
  watchWorktree,
} from "../../../tui/panes/filetree/pane-core"
import {
  type Row,
  flattenTree,
  reconcileRows,
  sameFileList,
  sameStatusEntries,
  statusRows,
} from "../../../tui/panes/filetree/rows"
import { type TreeNode, buildTree } from "../../../tui/panes/filetree/tree"
import { PaneKeyHint, usePaneHintMark } from "../../component/keyboard-hints"
import { useTheme } from "../../context/theme"
import { useT } from "../../i18n"
import { useBindings } from "../../lib/keymap"
import { useLatest } from "../../lib/use-latest"
import { FileTreeHeaderView } from "./header-view"
import { FileTreeBodyView } from "./body-view"

/** Public props. */
export type FileTreeProps = {
  /** Active task's worktree path; `null` renders the "No worktree" placeholder. */
  worktreePath: string | null
  /** Task's PR base ref (`task.prStatus.baseRef`), when it has an open PR —
   *  the preferred base for Branch (vs-base) scope. Absent falls back to the
   *  repo's default branch (`resolveBase`). */
  prBaseRef?: string
  /** Fires when the user activates a row (enter / click); worktree-relative path. */
  onOpenFile: (relPath: string) => void
  /** `d` — open the current file's read-only diff in a workspace content tab.
   *  `base` (Branch scope) makes it a vs-base diff; omitted = diff vs HEAD. */
  onOpenDiff?: (relPath: string, base?: string) => void
  /** `a` — paste an `@<path>` mention into the engine's composer, no submit
   *  (workspace host only; see docs/TUI.md). */
  onMention?: (relPath: string) => void
  /** `p` — request PR creation (workspace host only); also rendered as a chip. */
  onCreatePR?: () => void
  /** Zen-mode chip left of Create PR (enter-only). */
  onZenToggle?: () => void
  /** Whether the pane has keyboard focus. Defaults to `true`. */
  focused?: boolean
  /** CONTENT width (cells) of the box this pane renders in. The pane is a
   *  narrow column inside the workspace, so the Changes-tab path budget must
   *  come from this, not the full terminal width — otherwise tail-keeping
   *  truncation never fires and long paths right-clip, losing the filename.
   *  Defaults to the terminal width for hosts that give the pane full width. */
  paneWidth?: number
}

export function FileTree(props: FileTreeProps) {
  const { theme } = useTheme()
  const t = useT()
  // Fallback width when the host doesn't pass `paneWidth` (full-width hosts).
  const dims = useTerminalDimensions()

  // ---------- pane state ----------
  const [tab, setTab] = useState<FileTreeTab>("all")
  // Changes-tab scope: uncommitted work vs the whole branch vs its base.
  // `scopeManual` tracks whether the user pressed `b` — until then the pane
  // auto-falls-back to Branch scope when the working tree is clean (the
  // engine committed everything, so working scope would show nothing).
  const [scope, setScope] = useState<GitScope>("working")
  const [scopeManual, setScopeManual] = useState(false)
  // Resolved base ref for Branch scope (null = couldn't resolve → working
  // scope). Recomputed on worktree / prBaseRef change.
  const [base, setBase] = useState<string | null>(null)
  const [cursorIndex, setCursorIndex] = useState(0)
  // Bumped by `r` (and the opt-in fs watch) to force a re-fetch.
  const [refreshTick, setRefreshTick] = useState(0)
  const [allFiles, setAllFiles] = useState<string[] | null>(null)
  const [changes, setChanges] = useState<StatusEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Expanded directory paths (worktree-relative). Reset on worktree change.
  const [expandedDirs, setExpandedDirs] = useState<ReadonlySet<string>>(() => new Set())

  // Latest-render mirrors for effect bodies that must read a value without
  // depending on it.
  const pathRef = useLatest(props.worktreePath)
  const tabRef = useLatest(tab)
  const allFilesRef = useLatest(allFiles)
  const changesRef = useLatest(changes)
  const scopeRef = useLatest(scope)
  const baseRef = useLatest(base)
  const scopeManualRef = useLatest(scopeManual)
  const onOpenFileRef = useLatest(props.onOpenFile)
  const fetchSeq = useRef(0)

  /**
   * Fetch the data for a tab. Errors land in `error` and the row list goes
   * empty. The non-active tab's cache is wiped only on worktree change, not
   * on tab switch (cache-first tab pings). Content-equality functional
   * setters keep a no-change refresh from notifying downstream.
   */
  const refetch = useCallback(
    async (currentTab: FileTreeTab, path: string | null, signal?: AbortSignal): Promise<void> => {
      const seq = ++fetchSeq.current
      if (path == null) {
        setAllFiles(null)
        setChanges(null)
        setError(null)
        return
      }
      setError(null)
      try {
        if (currentTab === "all") {
          const files = await listFiles(path, signal)
          if (signal?.aborted || seq !== fetchSeq.current || pathRef.current !== path) return
          setAllFiles((prev) => (sameFileList(prev, files) ? prev : files))
        } else if (currentTab === "changes") {
          const wantBranch = scopeRef.current === "branch" && baseRef.current != null
          const entries = wantBranch
            ? await statusFilesBranch(path, baseRef.current as string, signal)
            : await statusFiles(path, signal)
          if (signal?.aborted || seq !== fetchSeq.current || pathRef.current !== path) return
          // Auto-fallback: a clean working tree in un-toggled working scope
          // means the engine committed everything — switch to Branch scope so
          // the task's output is visible. Only when a base resolved; the
          // scope change re-triggers this effect via the changes-scope effect.
          if (!wantBranch && entries.length === 0 && !scopeManualRef.current && baseRef.current != null) {
            setScope("branch")
            return
          }
          setChanges((prev) => (sameStatusEntries(prev, entries) ? prev : entries))
        }
      } catch (err) {
        // An aborted fetch (tab/worktree changed out from under us) throws
        // via the killed subprocess — swallow it, the next run owns state.
        if (signal?.aborted) return
        const message = errorMessage(err)
        if (seq === fetchSeq.current && pathRef.current === path) setError(message)
      }
    },
    [],
  )

  // Re-fetch when the worktree changes — wipe all caches first because the
  // previous worktree's cache does not apply. Cleanup aborts the in-flight
  // git read so
  // rapid task-switches don't stack subprocesses. Scope resets to its
  // auto-fallback default (working, un-toggled) for the new task.
  useEffect(() => {
    setAllFiles(null)
    setChanges(null)
    setError(null)
    setCursorIndex(0)
    setExpandedDirs(new Set<string>())
    setScope("working")
    setScopeManual(false)
    const controller = new AbortController()
    void refetch(tabRef.current, props.worktreePath, controller.signal)
    return () => controller.abort()
  }, [props.worktreePath, refetch])

  // Resolve the Branch-scope base ref for this worktree (prefers the task's
  // PR base, else the repo default branch). Runs on worktree / prBaseRef
  // change; a null result keeps the pane in working scope. `base` becoming
  // available is what lets the auto-fallback flip a clean worktree to Branch.
  useEffect(() => {
    const path = props.worktreePath
    if (path == null) {
      setBase(null)
      return
    }
    let disposed = false
    const controller = new AbortController()
    void resolveBase(path, props.prBaseRef, controller.signal)
      .then((b) => {
        if (!disposed) setBase(b)
      })
      .catch(() => {
        if (!disposed) setBase(null)
      })
    return () => {
      disposed = true
      controller.abort()
    }
  }, [props.worktreePath, props.prBaseRef])

  // Re-fetch the Changes tab when scope OR the resolved base changes — a
  // scope toggle (`b`) or an async base resolution both switch which diff the
  // tab shows. Only fires on the Changes tab; the All tab is scope-agnostic.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reads tab/path via refs; runs on the scope/base transition, matching the other refetch effects' shape.
  useEffect(() => {
    if (tabRef.current !== "changes") return
    const path = pathRef.current
    if (path == null) return
    const controller = new AbortController()
    void refetch("changes", path, controller.signal)
    return () => controller.abort()
  }, [scope, base, refetch])

  // Realtime watch is on by default; `ROVE_FILETREE_WATCH=0` opts out (see
  // watchWorktree) and leaves explicit refresh (`r`) plus tab/worktree
  // changes as the only paths that repopulate the pane.
  useEffect(() => {
    const path = props.worktreePath
    if (path == null) return
    if (readRoveEnv("FILETREE_WATCH") === "0") return
    return watchWorktree(path, () => setRefreshTick((n) => n + 1))
  }, [props.worktreePath])

  // Re-fetch when the active TAB changes — cache-first, so pinging between
  // already-loaded tabs never respawns git. Resetting the cursor belongs
  // here (a different tab is a different list); a refresh of the SAME tab
  // must NOT yank the cursor to the top (that effect is below).
  useEffect(() => {
    setCursorIndex(0)
    const path = pathRef.current
    if (path == null) return
    const controller = new AbortController()
    if (tab === "all") {
      if (allFilesRef.current == null) void refetch("all", path, controller.signal)
    } else if (tab === "changes") {
      if (changesRef.current == null) void refetch("changes", path, controller.signal)
    }
    return () => controller.abort()
  }, [tab, refetch])

  // Re-fetch on a real refresh tick (`r` or a debounced fs-watch event).
  // Tick 0 is the mount value — the worktree effect already did the first
  // fetch. Unlike a tab switch, a refresh PRESERVES the cursor (the clamp
  // effect below pulls it back only if the row count shrank past it).
  useEffect(() => {
    if (refreshTick === 0) return
    const path = pathRef.current
    if (path == null) return
    const controller = new AbortController()
    void refetch(tabRef.current, path, controller.signal)
    return () => controller.abort()
  }, [refreshTick, refetch])

  // Tree built once per `allFiles` change and reused while expansion
  // state mutates — flattening below is O(visible-rows).
  const tree = useMemo<TreeNode | null>(() => (allFiles == null ? null : buildTree(allFiles)), [allFiles])

  // Derived rows, reconciled against the previous list so unchanged rows
  // keep object identity (stable React keys + reference-equal memo output
  // when nothing changed), so opentui reuses the renderables.
  const prevRows = useRef<readonly Row[]>([])
  const rows = useMemo<readonly Row[]>(() => {
    const next: Row[] = []
    if (tab === "all") {
      if (tree != null) flattenTree(tree, expandedDirs, 0, next)
    } else if (tab === "changes") {
      // `expandedDirs` doubles as the Changes-tab untracked-dir expansion set —
      // status dir paths carry a trailing `/`, so the keys never collide with
      // the All tab's slash-less dir paths.
      if (changes != null) next.push(...statusRows(changes, expandedDirs))
    }
    const reconciled = reconcileRows(prevRows.current, next)
    prevRows.current = reconciled
    return reconciled
  }, [tab, tree, expandedDirs, changes])

  // Keep the cursor in range when a refresh shrinks the list. Tab switches
  // already reset the cursor to 0; this only clamps a preserved cursor that
  // now points past the end.
  useEffect(() => {
    if (rows.length === 0) return
    setCursorIndex((i) => (i > rows.length - 1 ? rows.length - 1 : i))
  }, [rows])

  const statWidths = useMemo(() => computeStatWidths(rows), [rows])
  const paneWidth = props.paneWidth ?? dims.width
  const pathBudget = useMemo(() => computePathBudget(paneWidth, statWidths), [paneWidth, statWidths])

  // ---------- key bindings ----------
  function applyNav(action: NavAction | null): void {
    if (!action) return
    if (action.type === "cursor") setCursorIndex(action.index)
    else if (action.type === "expand") setExpandedDirs((prev) => new Set(prev).add(action.path))
    else setExpandedDirs((prev) => toggleDir(prev, action.path))
  }

  /** Shared enter/click activation: dirs (All-tab dirs AND untracked-dir
   *  status rows, whose paths end `/`) toggle, files open. Stable (reads
   *  the open handler via ref) so the memoized rows share ONE callback. */
  const activateRow = useCallback((row: Row): void => {
    if (row.kind === "dir" || row.path.endsWith("/")) setExpandedDirs((prev) => toggleDir(prev, row.path))
    else onOpenFileRef.current(row.path)
  }, [])

  /** Mouse activation for rows: set the cursor there, then activate. ONE
   *  identity across renders so a j/k keystroke re-renders only the two
   *  rows whose `cursor` flag flipped (FileTreeRowView is memoized). */
  const handleRowActivate = useCallback(
    (row: Row, index: number): void => {
      setCursorIndex(index)
      activateRow(row)
    },
    [activateRow],
  )

  // Using the pane's own nav/open keys extinguishes its first-use hint.
  const markKeysUsed = usePaneHintMark("files")

  // `useBindings` re-reads the config per keypress through a render-refreshed
  // ref, so these closures always see the latest rows/cursor/tab.
  useBindings(() => ({
    enabled: props.focused ?? true,
    bindings: fileTreeBindings({
      moveDown: () => {
        markKeysUsed()
        if (rows.length === 0) return
        setCursorIndex((i) => Math.min(i + 1, rows.length - 1))
      },
      moveUp: () => {
        markKeysUsed()
        if (rows.length === 0) return
        setCursorIndex((i) => Math.max(i - 1, 0))
      },
      setTab,
      currentTab: () => tab,
      openCurrent: () => {
        markKeysUsed()
        const row = rows[cursorIndex]
        if (row) activateRow(row)
      },
      mentionCurrent: () => {
        const row = rows[cursorIndex]
        // Only files make sense as an @mention; dirs (incl. untracked-dir
        // status rows) are ignored.
        if (!row || row.kind === "dir" || row.path.endsWith("/")) return
        props.onMention?.(row.path)
      },
      openExternal: () => {
        const row = rows[cursorIndex]
        if (!row || row.kind === "dir" || row.path.endsWith("/")) return
        if (!props.worktreePath) return
        openExternally(`${props.worktreePath}/${row.path}`)
      },
      refresh: () => {
        setRefreshTick((n) => n + 1)
      },
      toggleScope: () => {
        // Only meaningful on the Changes tab; Branch scope needs a base.
        if (tab !== "changes") return
        if (base == null) return
        setScopeManual(true)
        setScope((s) => (s === "working" ? "branch" : "working"))
      },
      openDiff: () => {
        const row = rows[cursorIndex]
        if (!row) return
        // A directory is a git PATHSPEC, so it opens the combined diff of
        // everything under it in ONE tab — reviewing a 12-file attempt used to
        // cost 12 presses and 12 tabs. Normalised with a trailing slash: that
        // is what tells the loader (and the preview) this diff spans files, so
        // an empty result reports "no changes in src/" instead of falling back
        // to reading a directory as if it were a file.
        const spec = row.kind === "dir" || row.path.endsWith("/") ? `${row.path.replace(/\/+$/, "")}/` : row.path
        // Branch scope diffs vs the resolved base; working scope vs HEAD.
        props.onOpenDiff?.(spec, scope === "branch" && base != null ? base : undefined)
      },
      openDiffAll: () => {
        props.onOpenDiff?.(".", scope === "branch" && base != null ? base : undefined)
      },
      expandOrDescend: () => applyNav(expandOrDescendAction(rows, cursorIndex)),
      collapseOrParent: () => applyNav(collapseOrParentAction(rows, cursorIndex)),
    }),
  }))

  // ---------- render ----------
  const loaded = (tab === "all" && allFiles != null) || (tab === "changes" && changes != null)
  return (
    <box flexDirection="column" flexGrow={1} paddingLeft={0} paddingRight={0}>
      <FileTreeHeaderView
        tab={tab}
        scope={scope}
        base={base}
        onSelectTab={setTab}
        onZenToggle={props.onZenToggle}
        onCreatePR={props.onCreatePR}
        onDiffAll={
          props.onOpenDiff
            ? () => props.onOpenDiff?.(".", scope === "branch" && base != null ? base : undefined)
            : undefined
        }
      />

      <FileTreeBodyView
        rows={rows}
        cursorIndex={cursorIndex}
        statWidths={statWidths}
        pathBudget={pathBudget}
        onActivate={handleRowActivate}
        worktreePath={props.worktreePath}
        error={error}
        loaded={loaded}
        tab={tab}
      />

      {/* Footer hint — shown only when a worktree is loaded so the
         "no task" placeholder stays clean. First use shows the fuller
         teaching line, then the pane's permanent short set; every cap is
         live keymap data (component/keyboard-hints.tsx). */}
      {props.worktreePath != null ? (
        <box flexDirection="row" justifyContent="flex-end" paddingTop={1} flexShrink={0}>
          <PaneKeyHint pane="files" />
        </box>
      ) : null}
    </box>
  )
}
