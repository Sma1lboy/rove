/** @jsxImportSource @opentui/react */
/**
 * File tree pane: React reactivity only, following THE ASYNC CANON
 * (`src/tui-react/history/host.tsx`): the last resolved value stays visible
 * during a refresh, stale completions drop (AbortController + fetch
 * sequence), and the fs watch bumps `refreshTick` rather than fetching.
 *
 * Fetch effects: worktree change (wipe + reload), tab change (cache-first +
 * cursor reset), refresh tick (cursor-preserving). Content-equality setters
 * keep no-change refreshes from re-rendering (see rows.ts).
 */

import { errorMessage } from "@/lib/error-message"
import { readRoveEnv } from "@sma1lboy/kobe-daemon/compat-env"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
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
import { useBindings } from "../../lib/keymap"
import { useLatest } from "../../lib/use-latest"
import { useTerminalDimensions } from "../../lib/use-terminal-dimensions"
import { FileTreeBodyView } from "./body-view"
import { FileTreeHeaderView } from "./header-view"

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
  /** CONTENT width (cells) of this pane; the path budget must come from it, not
   *  the terminal width, or long paths right-clip and lose the filename.
   *  Defaults to the terminal width. */
  paneWidth?: number
}

export function FileTree(props: FileTreeProps) {
  const dims = useTerminalDimensions()

  const [tab, setTab] = useState<FileTreeTab>("all")
  // Until the user presses `b` (`scopeManual`), a clean working tree
  // auto-falls-back to Branch scope: the engine committed everything.
  const [scope, setScope] = useState<GitScope>("working")
  const [scopeManual, setScopeManual] = useState(false)
  // Branch-scope base ref; null = unresolved → working scope only.
  const [base, setBase] = useState<string | null>(null)
  const [cursorIndex, setCursorIndex] = useState(0)
  // Bumped by `r` (and the opt-in fs watch) to force a re-fetch.
  const [refreshTick, setRefreshTick] = useState(0)
  const [allFiles, setAllFiles] = useState<string[] | null>(null)
  const [changes, setChanges] = useState<StatusEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Expanded directory paths (worktree-relative). Reset on worktree change.
  const [expandedDirs, setExpandedDirs] = useState<ReadonlySet<string>>(() => new Set())

  const pathRef = useLatest(props.worktreePath)
  const tabRef = useLatest(tab)
  const allFilesRef = useLatest(allFiles)
  const changesRef = useLatest(changes)
  const scopeRef = useLatest(scope)
  const baseRef = useLatest(base)
  const scopeManualRef = useLatest(scopeManual)
  const onOpenFileRef = useLatest(props.onOpenFile)
  const fetchSeq = useRef(0)

  /** Fetch a tab's data. The other tab's cache is wiped only on worktree
   *  change, so tab switches are cache-first. */
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
          // Auto-fallback to Branch scope (needs a base); the scope effect refetches.
          if (!wantBranch && entries.length === 0 && !scopeManualRef.current && baseRef.current != null) {
            setScope("branch")
            return
          }
          setChanges((prev) => (sameStatusEntries(prev, entries) ? prev : entries))
        }
      } catch (err) {
        // An aborted fetch throws via the killed subprocess; the next run owns state.
        if (signal?.aborted) return
        const message = errorMessage(err)
        if (seq === fetchSeq.current && pathRef.current === path) setError(message)
      }
    },
    [],
  )

  // Worktree change: wipe caches and reset scope. Cleanup aborts the in-flight
  // git read so rapid task switches don't stack subprocesses.
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

  // Resolve the Branch-scope base; its arrival is what lets the auto-fallback flip.
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

  // Scope or base changed: refetch Changes (the All tab is scope-agnostic).
  // biome-ignore lint/correctness/useExhaustiveDependencies: reads tab/path via refs; runs on the scope/base transition, matching the other refetch effects' shape.
  useEffect(() => {
    if (tabRef.current !== "changes") return
    const path = pathRef.current
    if (path == null) return
    const controller = new AbortController()
    void refetch("changes", path, controller.signal)
    return () => controller.abort()
  }, [scope, base, refetch])

  // Watch is on by default; `ROVE_FILETREE_WATCH=0` leaves only `r` and tab/worktree changes.
  useEffect(() => {
    const path = props.worktreePath
    if (path == null) return
    if (readRoveEnv("FILETREE_WATCH") === "0") return
    return watchWorktree(path, () => setRefreshTick((n) => n + 1))
  }, [props.worktreePath])

  // Tab change: cache-first, and the only place the cursor resets — a
  // refresh of the SAME tab must not yank it to the top.
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

  // Refresh tick (`r` or fs watch). Tick 0 is mount; the worktree effect fetched.
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

  // Reconciled so unchanged rows keep identity and opentui reuses renderables.
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

  // Clamp a preserved cursor when a refresh shrinks the list.
  useEffect(() => {
    if (rows.length === 0) return
    setCursorIndex((i) => (i > rows.length - 1 ? rows.length - 1 : i))
  }, [rows])

  const statWidths = useMemo(() => computeStatWidths(rows), [rows])
  const paneWidth = props.paneWidth ?? dims.width
  const pathBudget = useMemo(() => computePathBudget(paneWidth, statWidths), [paneWidth, statWidths])

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

  /** ONE identity across renders so j/k re-renders only the two rows whose
   *  `cursor` flag flipped (FileTreeRowView is memoized). */
  const handleRowActivate = useCallback(
    (row: Row, index: number): void => {
      setCursorIndex(index)
      activateRow(row)
    },
    [activateRow],
  )

  // Using the pane's own nav/open keys extinguishes its first-use hint.
  const markKeysUsed = usePaneHintMark("files")

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
        // Files only; untracked-dir status rows end `/`.
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
        // A directory is a pathspec → one combined diff. The trailing slash
        // tells the loader it spans files, so an empty result says "no changes
        // in src/" instead of reading the directory as a file.
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
