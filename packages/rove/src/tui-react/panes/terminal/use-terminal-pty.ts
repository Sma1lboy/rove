/**
 * PTY acquire/subscribe lifecycle for the embedded terminal pane:
 *
 *   - Once `cwd`/`taskId` resolve and the body has measured, acquire a
 *     `TaskPty`; `acquire` reuses a live PTY for the same key.
 *   - A key change NEVER kills the outgoing PTY (the orchestrator owns
 *     release); unmount drops only our subscription and reference.
 *
 * The acquire effect depends ONLY on `[cwd, taskId, geometryReady]`;
 * `command` and live geometry are read from refs, so a prop swap alone
 * doesn't re-acquire (that is `resetToken`'s job).
 */

import { errorMessage } from "@/lib/error-message"
import { useRenderer } from "@opentui/react"
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
import { terminalFrameScheduler } from "./terminal-frame-scheduler"

/** Stable empty flags for backends that report none. */
const NO_WRAP: RowWrapFlags = []

export interface UseTerminalPtyOpts {
  cwd: string | null
  taskId: string | null
  /** Read at acquire/reset time via a ref — see file header. */
  command: readonly string[] | undefined
  /** Typed into a FRESH spawn (`TaskPtyOpts.initialInput`). Read via a ref. */
  initialInput?: string
  /** Pasted once a fresh spawn's engine is up (`TaskPtyOpts.firstMessage`). Read via a ref. */
  firstMessage?: string
  /** Engine binary name for the first-message engine-up probe. */
  engineBin?: string
  /** Current Rove theme colors reported to the embedded terminal child. */
  defaultColors?: TaskPtyOpts["defaultColors"]
  /** Engine-owned cell substitutions for the alternate screen only. */
  alternateScreenStyleRewrites?: TaskPtyOpts["alternateScreenStyleRewrites"]
  resetToken?: number
  /** `deadOnAttach`: found dead on reattach, not observed live (see `TaskPtyLike`). */
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
  const scheduleRefreshRef = useLatest(terminalFrameScheduler(useRenderer()))
  const [pty, setPty] = useState<TaskPty | null>(null)
  // Surfaced when `registry.acquire()` throws, or the pane renders blank.
  const [acquireError, setAcquireError] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<readonly TerminalRow[]>([])
  const snapshotWindowRef = useRef<TerminalSnapshotWindow | null>(null)
  // A ref written in the `onData` that calls `setSnapshot`, so that render sees matching flags.
  const wrappedRef = useRef<RowWrapFlags>(NO_WRAP)
  const [cursor, setCursor] = useState<CursorPos | null>(null)
  // Flips on PTY exit; the last snapshot stays, banner + F5 reset recover.
  const [exited, setExited] = useState(false)

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
  // For the resetToken effect; the acquire effect reads plain `cwd`/`taskId` on purpose.
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
        scheduleRefresh: scheduleRefreshRef.current,
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

  // Own effect keyed on `pty`, so it reattaches on ANY PTY change (switch, reset, recovery).
  useEffect(() => {
    const killed = pty ? pty.killed : false
    setExited(killed)
    if (!pty) return
    if (killed) {
      // Dead at mount: no handle to listen on, so fire onExit now.
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
    // Prime from the backend cache so a fresh pane doesn't blink empty.
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

  // Kill + fresh-acquire (F5 and `resetToken`); render signals reset together so
  // no stale snapshot/cursor survives onto the new PTY.
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
          scheduleRefresh: scheduleRefreshRef.current,
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
        // `registry.reset()` killed the old PTY first, so show the error, not a dead snapshot.
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

  // External forced-reacquire; skipped on mount.
  const resetMountedRef = useRef(false)
  useEffect(() => {
    // Trigger only.
    void opts.resetToken
    if (!resetMountedRef.current) {
      resetMountedRef.current = true
      return
    }
    const nextCwd = cwdRef.current
    const nextTaskId = taskIdRef.current
    const geometry = bodyGeometryRef.current
    if (nextCwd && nextTaskId && geometry) forceReacquire(nextCwd, nextTaskId, geometry)
    // `forceReacquire` is stable; listed for the linter.
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
