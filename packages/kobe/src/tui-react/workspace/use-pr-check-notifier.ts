/**
 * PR check-resolution toasts — the subscriber the daemon's PR poller was
 * written for.
 *
 * `pr-status-collector.ts` persists `task.prStatus.checkState` and fans it out
 * on `task.snapshot`, but nothing in the TUI read that field, so a CI run
 * finishing was silent: the only signal was the sidebar chip, which you have
 * to be looking at. That is the wrong shape for the case the poller exists for
 * — several tasks in flight while you sit in one of them.
 *
 * What counts as an edge is NOT decided here. `checkResolutionNotify`
 * (monitor/pr-status.ts) owns that rule — pending → passing/failing only — so
 * "CI started" (none → pending) and the flaps in between stay quiet. This hook
 * only diffs successive snapshots and hands each landing to `notif`.
 *
 * The SELECTED task toasts too, unlike `useAttention`'s engine-state edges:
 * check state has no middle-column indicator to defer to, only the same
 * sidebar chip every other task shows.
 */

import { useEffect, useRef } from "react"
import { checkResolutionNotify } from "../../monitor/pr-status"
import type { PRCheckState, Task } from "../../types/task"
import type { NotificationsContext } from "../context/notifications"
import { useT } from "../i18n"
import { useLatest } from "../lib/use-latest"

export function usePrCheckNotifier(args: {
  readonly tasks: readonly Task[]
  readonly notif: NotificationsContext
}): void {
  // Held by REF, not listed as deps: the notifications context is rebuilt on
  // every toast (its `toasts` array is in the provider's useMemo deps), so
  // depending on it would re-enter this effect after each notification it
  // raises — and re-entry also rewrites `prev`, the very thing the edge is
  // measured against. Same useLatest shape use-workspace-selection uses for
  // its worktree-gone notifier, for the same reason.
  const notif = useLatest(args.notif)
  const t = useLatest(useT())
  // Last snapshot's check state per task. No first-render seed guard is needed
  // (unlike useAttention's): an edge requires `prev === "pending"`, so a task
  // first SEEN as passing/failing — a restart replaying an already-settled
  // snapshot — cannot fire.
  const prev = useRef<ReadonlyMap<string, PRCheckState>>(new Map())
  useEffect(() => {
    const next = new Map<string, PRCheckState>()
    for (const task of args.tasks) {
      const state = task.prStatus?.checkState
      if (state === undefined) continue
      next.set(task.id, state)
      const landed = checkResolutionNotify(prev.current.get(task.id), state)
      if (!landed) continue
      notif.current.notify({
        kind: landed === "passing" ? "done" : "error",
        taskId: task.id,
        tabId: "",
        title: t.current(landed === "passing" ? "tasks.toast.checksPassingTitle" : "tasks.toast.checksFailingTitle", {
          title: task.title,
        }),
        body: t.current("tasks.toast.checksResolvedBody", {
          pr: task.prStatus?.number === undefined ? "—" : `#${task.prStatus.number}`,
          branch: task.branch || "—",
        }),
      })
    }
    prev.current = next
  }, [args.tasks])
}
