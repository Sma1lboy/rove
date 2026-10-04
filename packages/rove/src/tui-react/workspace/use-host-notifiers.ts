/**
 * Every toast `WorkspaceRoot` raises. Some are needed by hooks called BEFORE
 * `useWorkspaceSelection` produces `selectedId`, so it's taken as a GETTER read
 * at fire time (always after the render that built the closure).
 *
 * `taskId`/`tabId` are bookkeeping only (`ToastOverlay` draws kind/title/body;
 * nothing reads the unread map), so host toasts carry the selected task and "".
 */

import type { NotificationKind, NotificationsContext } from "../context/notifications"
import type { WorktreeGoneEvent } from "./use-workspace-selection"

export interface HostNotifiers {
  /**
   * Red failure toast: under the alternate screen `console.error` only reaches
   * the daemon log, so a failed key press would look like a no-op. Call sites
   * KEEP their `console.error` for forensics.
   */
  readonly notifyError: (message: string) => void
  /** Green "this happened" confirmation (engine cycled, creating task, already up to date). */
  readonly notifyInfo: (message: string) => void
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
  /** Read at fire time (see the header). */
  readonly selectedId: () => string | null
}): HostNotifiers {
  const { notif, t, selectedId } = args
  const post = (kind: NotificationKind, title: string): void => {
    notif.notify({ kind, taskId: selectedId() ?? "", tabId: "", title })
  }
  return {
    notifyError: (message) => post("error", message),
    notifyInfo: (message) => post("done", message),
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
