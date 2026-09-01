/**
 * The terminal pane's F5 reset. Its own hook because the two paths below are
 * one policy that must be decided together — the pre-split code got this wrong
 * (see the second bullet), which is exactly the failure a scattered gate
 * invites. Owns the confirm gate and the two ways a reset can be reached:
 *
 *  - a LIVE pty: confirm first (a running shell and its in-flight vim/htop
 *    are about to die), then reacquire, guarding against a task switch that
 *    happened while the confirm was open;
 *  - a FAILED acquire (`acquireError`, pty already null): retry immediately.
 *    There is nothing to destroy, the confirm's copy would be a lie, and this
 *    is the one state where the pane has no other way out — the pre-split
 *    guard returned early here, so F5 did nothing at all.
 */

import { useLayoutEffect, useRef } from "react"
import type { TaskPty } from "../../../tui/panes/terminal/pty"
import { useT } from "../../i18n"
import { useLatest } from "../../lib/use-latest"
import type { DialogContext } from "../../ui/dialog"
import { DialogConfirm } from "../../ui/dialog-confirm"

export function useTerminalReset(args: {
  readonly pty: TaskPty | null
  readonly acquireError: string | null
  readonly cwd: string | null | undefined
  readonly taskId: string | null | undefined
  readonly bodyGeometry: { cols: number; rows: number } | null
  readonly forceReacquire: (
    cwd: string,
    taskId: string,
    geometry: { cols: number; rows: number },
    expected?: TaskPty,
  ) => void
  readonly dialog: DialogContext
}): () => void {
  const t = useT()
  const resetTaskIdRef = useLatest(args.taskId)
  const resetCwdRef = useLatest(args.cwd)
  const mountedRef = useRef(true)
  useLayoutEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  return (): void => {
    if (!args.pty && !args.acquireError) return
    // Snapshot at click-time so a task switch mid-confirm doesn't reset
    // the wrong shell.
    const ptyAtClick = args.pty
    const cwdAtClick = args.cwd
    const taskIdAtClick = args.taskId
    const geometryAtClick = args.bodyGeometry
    if (!cwdAtClick || !taskIdAtClick || !geometryAtClick) return
    // No live PTY means nothing to destroy, and the confirm's copy ("the
    // running shell will be killed") would be a lie. Retry straight away —
    // a confirm here is a second obstacle in a state the user is stuck in.
    if (!ptyAtClick) {
      args.forceReacquire(cwdAtClick, taskIdAtClick, geometryAtClick)
      return
    }
    void DialogConfirm.show(args.dialog, t("terminal.reset.title"), t("terminal.reset.body"), "cancel").then((ok) => {
      if (ok !== true || !mountedRef.current) return
      if (resetTaskIdRef.current !== taskIdAtClick || resetCwdRef.current !== cwdAtClick) return
      args.forceReacquire(cwdAtClick, taskIdAtClick, geometryAtClick, ptyAtClick)
    })
  }
}
