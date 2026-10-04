/**
 * The terminal pane's F5 reset, one policy for both paths:
 *
 *  - a LIVE pty: confirm first (in-flight vim/htop will die), then reacquire,
 *    guarding against a task switch while the confirm was open;
 *  - a FAILED acquire (pty null): retry immediately. Nothing to destroy, and
 *    this is the one state with no other way out.
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
    // No live PTY: the confirm's "shell will be killed" would be a lie.
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
