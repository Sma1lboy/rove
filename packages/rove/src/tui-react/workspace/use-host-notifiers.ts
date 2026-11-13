/**
 * Every toast `WorkspaceRoot` raises. Action toasts carry no `taskId`: a toast with one opens that task when clicked.
 */

import type { ToastOptions } from "../../tui/lib/notify-state"
import type { NotificationKind, NotificationsContext } from "../context/notifications"
import type { WorktreeGoneEvent } from "./use-workspace-selection"

export interface HostNotifiers {
  /**
   * Red failure toast: under the alternate screen `console.error` only reaches
   * the daemon log, so a failed key press would look like a no-op. Call sites
   * KEEP their `console.error` for forensics.
   */
  readonly notifyError: (message: string, opts?: ToastOptions) => void
  /** Green "this happened" confirmation (engine cycled, creating task, already up to date). */
  readonly notifyInfo: (message: string, opts?: ToastOptions) => void
  /** Amber "over to you": stopped on something only the user can settle
   *  (land conflict, dirty base, kept worktree). */
  readonly notifyNeedsInput: (message: string) => void
  /** Carries the affected task's id, not the selection: another client may
   *  remove a worktree while the user looks at a different task. */
  readonly notifyWorktreeGone: (event: WorktreeGoneEvent) => void
}

export function useHostNotifiers(args: {
  readonly notif: NotificationsContext
  readonly t: (key: string, params?: Record<string, string | number>) => string
}): HostNotifiers {
  const { notif, t } = args
  const post = (kind: NotificationKind, title: string, opts?: ToastOptions): void => {
    notif.notify({ kind, taskId: "", tabId: "", title, ...opts })
  }
  return {
    notifyError: (message, opts) => post("error", message, opts),
    notifyInfo: (message, opts) => post("done", message, opts),
    notifyNeedsInput: (message) => post("needs_input", message),
    notifyWorktreeGone: (event) =>
      notif.notify({
        kind: "error",
        taskId: event.taskId,
        tabId: "",
        title: t("tasks.toast.worktreeGoneTitle", { title: event.title }),
        body: t("tasks.toast.worktreeGoneBody", { count: String(event.closed), branch: event.branch || "—" }),
      }),
  }
}
