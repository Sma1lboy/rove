/**
 * Toasts for PR check resolution (`task.prStatus.checkState` from
 * `pr-status-collector.ts`); otherwise the only signal is a sidebar chip you
 * must be looking at. `checkResolutionNotify` (monitor/pr-status.ts) owns the
 * edge rule (pending → passing/failing only), so "CI started" stays quiet.
 * The SELECTED task toasts too: check state has no middle-column indicator.
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
  // By REF: the context is rebuilt on every toast, so as a dep this effect would
  // re-enter after each notification it raises and rewrite `prev`.
  const notif = useLatest(args.notif)
  const t = useLatest(useT())
  // No seed guard needed: an edge requires `prev === "pending"`, so a restart
  // replaying settled state can't fire.
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
