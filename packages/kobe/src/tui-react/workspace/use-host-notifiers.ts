/**
 * Every toast `WorkspaceRoot` raises, in one place.
 *
 * The ordering problem this settles: three of these are wanted by hooks the
 * host calls BEFORE `useWorkspaceSelection`, which produces the `selectedId`
 * they tag with. That used to be handled by declaring two notifiers by hand
 * ahead of the selection hook, each carrying a comment explaining why. Taking
 * `selectedId` as a GETTER settles it once — the closure reads the current
 * render's value at the moment a toast fires, which is always later than the
 * render that built it.
 *
 * `taskId`/`tabId` are bookkeeping, not display: `ToastOverlay` draws kind,
 * title and body only, and nothing reads the notifications context's unread
 * map. A host action is not tab-scoped, so these carry the selected task and
 * an empty tab.
 */

import type { NotificationKind, NotificationsContext } from "../context/notifications"
import type { WorktreeGoneEvent } from "./use-workspace-selection"

export interface HostNotifiers {
  /**
   * Surface a user-action FAILURE as a red error toast. Under an alternate
   * screen a bare `console.error` is invisible (it only reaches the daemon
   * log), so a failed key press would otherwise look like a silent no-op.
   * Call sites KEEP their matching `console.error` for log forensics — this
   * is the on-screen half.
   */
  readonly notifyError: (message: string) => void
  /**
   * Neutral (non-error) toast — same on-screen surfacing as notifyError but
   * green/`done` styling, for "this happened" confirmations (engine cycled,
   * creating task, already up to date) that aren't failures.
   */
  readonly notifyInfo: (message: string) => void
  /** Amber "over to you" — an action stopped on something only the user can
   *  settle (a land conflict, a dirty base, a kept worktree). */
  readonly notifyNeedsInput: (message: string) => void
  /**
   * A task's worktree vanished out-of-band and its tabs went with it. Carries
   * the affected task's id rather than the selection: the user may well be
   * looking at a different task when another client removes this one's
   * worktree.
   */
  readonly notifyWorktreeGone: (event: WorktreeGoneEvent) => void
}

export function useHostNotifiers(args: {
  readonly notif: NotificationsContext
  readonly t: (key: string, params?: Record<string, string | number>) => string
  /** Read at fire time, not at build time — see the module header. */
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
