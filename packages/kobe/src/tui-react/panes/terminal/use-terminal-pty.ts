/**
 * PTY acquire/subscribe lifecycle for the embedded terminal pane:
 *
 *   - When `cwd`/`taskId` resolve (and the body has measured), acquire a
 *     `TaskPty` from the registry; `acquire` reuses a live PTY for the
 *     same key — the "kept alive while in_progress" rule.
 *   - On a key change we DON'T kill the outgoing PTY (the orchestrator owns
 *     release); we just resubscribe to the new one's data.
 *   - On unmount we drop our subscription and reference only.
 *
 * The acquire effect depends ONLY on `[cwd, taskId, geometryReady]`.
 * `command` and the live geometry value are kept in refs and read at acquire
 * time, so a caller's prop swap alone does not force a re-acquire — that is
 * what `resetToken` is for.
 */

import { errorMessage } from "@/lib/error-message"
import { useCallback, useEffect, useRef, useState } from "react"
import type {
  CursorPos,
  TaskPty,
  TaskPtyOpts,
  TerminalRow,
  TerminalSnapshotWindow,
} from "../../../tui/panes/terminal/pty"
import type { PtyRegistry } from "../../../tui/panes/terminal/registry"
import type { RowWrapFlags } from "../../../tui/panes/terminal/terminal-wrap"
import { useLatest } from "../../lib/use-latest"

/** Shared empty flags — a stable reference for backends that report none. */
const NO_WRAP: RowWrapFlags = []

export interface UseTerminalPtyOpts {
  cwd: string | null
  taskId: string | null
  /** Read at acquire/reset time via a ref — see file header. */
  command: readonly string[] | undefined
  /** Typed into a FRESH spawn (`TaskPtyOpts.initialInput`) — the shell-
   *  wrapped engine line. Read via a ref like `command`. */
  initialInput?: string
  /** Paste-delivery vendor's first message (`TaskPtyOpts.firstMessage`) —
   *  the hosted backend pastes it once the fresh-spawned engine is up.
   *  Read via a ref like `command`. */
  firstMessage?: string
  /** Engine binary name for the first-message engine-up probe. */
  engineBin?: string
  /** Current Rove theme colors reported to the embedded terminal child. */
  defaultColors?: TaskPtyOpts["defaultColors"]
  /** Engine-owned cell substitutions for the alternate screen only. */
  alternateScreenStyleRewrites?: TaskPtyOpts["alternateScreenStyleRewrites"]
  resetToken?: number
  /** `deadOnAttach`: the exit was discovered on reattach (engine died
   *  while the TUI was away), not observed live — see `TaskPtyLike`. */
  onExit?: (info?: { deadOnAttach?: boolean }) => void
  registry: PtyRegistry
  bodyGeometry: { cols: number; rows: number } | null
  /** Fires whenever a (re)acquire lands a fresh PTY — the pane resets its scrollback view. */
  onFreshPty: () => void
}

export interface UseTerminalPtyResult {
  pty: TaskPty | null
  snapshot: readonly TerminalRow[]
  snapshotWindow: TerminalSnapshotWindow | null
  /** Soft-wrap flags parallel to `snapshot` — see `DataListener`. */
  wrapped: RowWrapFlags
  cursor: CursorPos | null
  exited: boolean
  acquireError: string | null
  forceReacquire: (cwd: string, taskId: string, geometry: { cols: number; rows: number }, expected?: TaskPty) => void
}

export function useTerminalPty(opts: UseTerminalPtyOpts): UseTerminalPtyResult {
  const [pty, setPty] = useState<TaskPty | null>(null)
  // Surfaced when `registry.acquire()` throws — without this the pane
  // would render blank with no hint as to why.
  const [acquireError, setAcquireError] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<readonly TerminalRow[]>([])
  const snapshotWindowRef = useRef<TerminalSnapshotWindow | null>(null)
  // A ref for the same reason `snapshotWindow` is one: it is written in the
  // same `onData` callback that calls `setSnapshot`, so the render triggered
  // by that state change already sees the flags belonging to those rows.
  const wrappedRef = useRef<RowWrapFlags>(NO_WRAP)
  const [cursor, setCursor] = useState<CursorPos | null>(null)
  // Dead-shell flag (revival checklist #5): flips when the PTY reports
  // exit for any reason. The last snapshot stays visible; the banner +
  // F5 reset are the recovery path.
  const [exited, setExited] = useState(false)

  // Latest-render mirrors read by effect bodies that must NOT depend on them.
  const commandRef = useLatest(opts.command)
  const initialInputRef = useLatest(opts.initialInput)
  const firstMessageRef = useLatest(opts.firstMessage)
  const engineBinRef = useLatest(opts.engineBin)
  const defaultColorsRef = useLatest(opts.defaultColors)
  const alternateScreenStyleRewritesRef = useLatest(opts.alternateScreenStyleRewrites)
  const bodyGeometryRef = useLatest(opts.bodyGeometry)
  const registryRef = useLatest(opts.registry)
  const onExitRef = useLatest(opts.onExit)
  const onFreshPtyRef = useLatest(opts.onFreshPty)
  // Read untracked by the resetToken effect below (see file header); the
  // acquire effect intentionally reads the plain `cwd`/`taskId` values
  // instead, since THAT effect is meant to depend on them.
  const cwdRef = useLatest(opts.cwd)
  const taskIdRef = useLatest(opts.taskId)

  const geometryReady = opts.bodyGeometry !== null
  const cwd = opts.cwd
  const taskId = opts.taskId

  useEffect(() => {
    if (!cwd || !taskId || !geometryReady) {
      setPty(null)
      setSnapshot([])
      snapshotWindowRef.current = null
      wrappedRef.current = NO_WRAP
      setCursor(null)
      setAcquireError(null)
      return
    }
    const geometry = bodyGeometryRef.current
    if (!geometry) return
    let handle: TaskPty
    try {
      handle = registryRef.current.acquire(taskId, cwd, {
        ...geometry,
        command: commandRef.current,
        initialInput: initialInputRef.current,
        firstMessage: firstMessageRef.current,
        engineBin: engineBinRef.current,
        defaultColors: defaultColorsRef.current,
        alternateScreenStyleRewrites: alternateScreenStyleRewritesRef.current,
      })
    } catch (err) {
      const message = errorMessage(err)
      setAcquireError(message)
      setPty(null)
      setSnapshot([])
      snapshotWindowRef.current = null
      wrappedRef.current = NO_WRAP
      setCursor(null)
      return
    }
    setAcquireError(null)
    setSnapshot([])
    snapshotWindowRef.current = null
    wrappedRef.current = NO_WRAP
    setCursor(null)
    setExited(handle.killed)
    setPty(handle)
    // Reset the caller's viewport on task switch — every task gets its own.
    onFreshPtyRef.current()
  }, [cwd, taskId, geometryReady])

  // Subscribe to whichever PTY is currently active. Own effect (keyed on
  // `pty`) instead of folded into the acquire effect so it reattaches
  // whenever the active PTY changes for any reason — task switch, reset,
  // or recovery after an external kill.
  useEffect(() => {
    const killed = pty ? pty.killed : false
    setExited(killed)
    if (!pty) return
    if (killed) {
      // Already dead by the time we mounted — fire onExit now, there's no
      // live handle to attach a listener to.
      onExitRef.current?.({ deadOnAttach: pty.deadOnAttach === true })
      return
    }
    const unsubscribeExit = pty.onExit(() => {
      setExited(true)
      onExitRef.current?.({ deadOnAttach: pty.deadOnAttach === true })
    })
    const unsubscribe = pty.onData((snap, c, window, wrapped) => {
      snapshotWindowRef.current = window
      wrappedRef.current = wrapped ?? NO_WRAP
      setSnapshot(snap)
      setCursor(c)
    })
    // Prime the renderer with whatever the backend has cached so a
    // freshly-mounted (or freshly-reset) pane doesn't blink empty for one
    // tick.
    try {
      const initial = pty.capture()
      snapshotWindowRef.current = pty.captureWindow()
      wrappedRef.current = pty.captureWrapped?.() ?? NO_WRAP
      if (initial.length > 0) setSnapshot(initial)
      setCursor(pty.captureCursor())
    } catch {
      /* capture can fail on a freshly-spawned shell; ignore */
    }
    return () => {
      unsubscribeExit()
      unsubscribe()
    }
  }, [pty])

  // Kill + fresh-acquire under the same `cwd`/`taskId` (shared by the F5
  // confirm and the external `resetToken` bump) — reset the render
  // signals together so a stale snapshot/cursor never survives onto the
  // new PTY.
  const forceReacquire = useCallback(
    (nextCwd: string, nextTaskId: string, geometry: { cols: number; rows: number }, expected?: TaskPty): void => {
      try {
        const opts = {
          ...geometry,
          command: commandRef.current,
          initialInput: initialInputRef.current,
          firstMessage: firstMessageRef.current,
          engineBin: engineBinRef.current,
          defaultColors: defaultColorsRef.current,
          alternateScreenStyleRewrites: alternateScreenStyleRewritesRef.current,
        }
        const fresh = expected
          ? registryRef.current.resetIfCurrent(nextTaskId, expected, nextCwd, opts)
          : registryRef.current.reset(nextTaskId, nextCwd, opts)
        if (!fresh) return
        setPty(fresh)
        setSnapshot([])
        snapshotWindowRef.current = null
        wrappedRef.current = NO_WRAP
        setCursor(null)
        onFreshPtyRef.current()
      } catch (err) {
        const message = errorMessage(err)
        // `registry.reset()` kills the outgoing PTY BEFORE the acquire half runs,
        // so on failure there is no live handle left — clear the pane to the
        // error state (same shape as the acquire effect's failure path)
        // instead of leaving a dead snapshot up with the error invisible.
        setAcquireError(message)
        setPty(null)
        setSnapshot([])
        snapshotWindowRef.current = null
        wrappedRef.current = NO_WRAP
        setCursor(null)
      }
    },
    [],
  )

  // External forced-reacquire (see `resetToken` on TerminalProps) — skipped
  // on the initial mount so a fresh pane doesn't reset itself the instant it
  // acquires its first PTY.
  const resetMountedRef = useRef(false)
  useEffect(() => {
    // Dependency-only invalidation key — this effect fires ONLY when
    // resetToken bumps, it doesn't read the value itself.
    void opts.resetToken
    if (!resetMountedRef.current) {
      resetMountedRef.current = true
      return
    }
    const nextCwd = cwdRef.current
    const nextTaskId = taskIdRef.current
    const geometry = bodyGeometryRef.current
    if (nextCwd && nextTaskId && geometry) forceReacquire(nextCwd, nextTaskId, geometry)
    // `forceReacquire` is stable (empty-dep useCallback below) — listing it
    // satisfies the linter without changing when this effect re-fires.
  }, [opts.resetToken, forceReacquire])

  return {
    pty,
    snapshot,
    snapshotWindow: snapshotWindowRef.current,
    wrapped: wrappedRef.current,
    cursor,
    exited,
    acquireError,
    forceReacquire,
  }
}
