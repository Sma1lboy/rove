/**
 * Cross-task attention for the native workspace host:
 *
 *  1. Rising-edge notify for any NON-selected task crossing into an attention
 *     state ({@link attentionKindFor}), gated by `notifications.crossTask.enabled`.
 *     Diffs the PER-TAB map: the task rollup is last-event-wins, so two tabs
 *     finishing in a row leave it at `turn_complete` and the second never
 *     fires. Inbox episodes are keyed `(taskId, tabId)` too. Tasks with no tab
 *     identity (`claude` typed into a plain shell, no KOBE_TAB_ID) notify off
 *     the rollup.
 *  2. F7 walks available pending items in the daemon-owned Inbox; visiting the
 *     target resolves it.
 *
 * Inputs are engine-owned and vendor-neutral, so no Claude/Codex strings here.
 */

import { useEffect, useRef } from "react"
import type { AttentionInboxItem, TaskEngineState } from "../../client/remote-orchestrator"
import { attentionEdges, attentionKindFor } from "../../tui/lib/notify-state"
import { sidebarProjectLabel } from "../../tui/panes/sidebar/groups"
import { tabTitleStable } from "../../tui/workspace/terminal-tabs-core"
import { DEFAULT_TASK_VENDOR, type Task } from "../../types/task"
import type { KVContext } from "../context/kv"
import type { NotificationsContext } from "../context/notifications"
import { isAttentionInboxItemAvailable, nextAttentionInboxTarget } from "./attention-inbox-core"
import { activeTabIdFor, knownTaskTab, taskTabExists } from "./terminal-tabs-shared"

const CROSS_TASK_KEY = "notifications.crossTask.enabled"

/** A tab, or a whole task (`tabId` "") when its engine reports no tab identity. */
function notifyTargetKey(taskId: string, tabId: string): string {
  return `${taskId}:${tabId}`
}

export type NotifyTarget = { readonly taskId: string; readonly tabId: string }

/**
 * One entry per notify target: per tab, or the task rollup when no tab
 * reports. Never both: the rollup mirrors whichever tab moved last, so it
 * would double-count. Pure, so "two tabs finish in a row" is testable.
 */
export function notifyTargetStates(
  engineState: ReadonlyMap<string, TaskEngineState>,
  engineTabState?: ReadonlyMap<string, ReadonlyMap<string, TaskEngineState>>,
): { states: Map<string, string>; targets: Map<string, NotifyTarget> } {
  const states = new Map<string, string>()
  const targets = new Map<string, NotifyTarget>()
  for (const [taskId, es] of engineState) {
    const tabs = engineTabState?.get(taskId)
    // Idle entries are known-idle tombstones: they don't make a task
    // "tab-covered", so a task with only tombstones still notifies from its
    // rollup (untagged external sessions report task-level only).
    const liveTabs = tabs ? [...tabs].filter(([, tabEs]) => tabEs.state !== "idle") : []
    if (liveTabs.length > 0) {
      for (const [tabId, tabEs] of liveTabs) {
        const key = notifyTargetKey(taskId, tabId)
        states.set(key, tabEs.state)
        targets.set(key, { taskId, tabId })
      }
      continue
    }
    const key = notifyTargetKey(taskId, "")
    states.set(key, es.state)
    targets.set(key, { taskId, tabId: "" })
  }
  return { states, targets }
}

export function useAttention(args: {
  tasks: readonly Task[]
  engineState: ReadonlyMap<string, TaskEngineState>
  /** `taskId → tabId → state`; absent for engines with no tab identity. */
  engineTabState?: ReadonlyMap<string, ReadonlyMap<string, TaskEngineState>>
  inboxItems: readonly AttentionInboxItem[]
  selectedId: string | null
  kv: KVContext
  notif: NotificationsContext
  openAttention: (item: AttentionInboxItem) => void
  /** i18n'd toast shown when the chord finds no available Inbox item. */
  noTasksMessage: string
}): { jumpToNextAttention: () => void } {
  const { tasks, engineState, engineTabState, inboxItems, selectedId, kv, notif, openAttention, noTasksMessage } = args

  // Seeded on first render so targets already in an attention state at mount
  // don't fire a burst of stale toasts.
  const prevStates = useRef<Map<string, string> | null>(null)

  useEffect(() => {
    const { states: next, targets } = notifyTargetStates(engineState, engineTabState)

    // The selected task is filtered AFTER the diff, not via `skip` (one key):
    // all its tabs must be excluded (the middle column shows it; background
    // tabs belong to `use-tab-turn-state`'s notifier). Dropping them from
    // `next` instead would fire stale edges on every task switch.
    const edges = attentionEdges(prevStates.current, next, null, attentionKindFor)
    prevStates.current = next
    if (kv.get(CROSS_TASK_KEY, true) === false) return
    const repos = [...new Set(tasks.map((t) => t.repo))]
    // Index once instead of a `tasks.find` per edge.
    const taskById = new Map<string, Task>(tasks.map((task) => [task.id, task]))
    for (const { key, kind } of edges) {
      const target = targets.get(key)
      if (!target || target.taskId === selectedId) continue
      const task = taskById.get(target.taskId)
      // Mirrors the Inbox card: task title, then project (+ tab, so two tabs
      // of one task don't read identically).
      const project = task ? sidebarProjectLabel(task.repo, repos) : ""
      const tab = target.tabId ? knownTaskTab(kv, target.taskId, target.tabId) : undefined
      const tabLabel = tab ? tabTitleStable(tab, task?.vendor ?? DEFAULT_TASK_VENDOR) : ""
      notif.notify({
        kind,
        taskId: target.taskId,
        tabId: target.tabId,
        title: task?.title ?? target.taskId,
        body: tabLabel ? `${project} › ${tabLabel}` : project || undefined,
      })
    }
  }, [engineState, engineTabState, selectedId, tasks, kv, notif])

  function jumpToNextAttention(): void {
    const order = tasks.filter((t) => !t.deletion).map((t) => t.id)
    const target = nextAttentionInboxTarget(
      inboxItems,
      order,
      {
        taskId: selectedId,
        tabId: selectedId ? activeTabIdFor(selectedId) : null,
      },
      // Tri-state: a binary check would skip episodes whose task just hasn't
      // mounted here and toast "nothing needs you".
      (item) =>
        isAttentionInboxItemAvailable(
          item,
          tasks.find((task) => task.id === item.taskId),
          (tabId) => (item.taskId === null ? undefined : taskTabExists(kv, item.taskId, tabId)),
        ),
    )
    if (!target) {
      notif.notify({ kind: "done", taskId: selectedId ?? "", tabId: "", title: noTasksMessage })
      return
    }
    openAttention(target)
  }

  return { jumpToNextAttention }
}
