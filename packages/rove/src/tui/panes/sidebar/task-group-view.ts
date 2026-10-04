/**
 * The one place the derived task group (`lib/task-group.ts`) becomes a tone,
 * label and sort key, so the board badge and `attention` sort agree.
 *
 * Deliberately NOT a row glyph: tab-level engine state and a task rollup in one
 * rail column read as a legend when both are lit.
 *
 * Group, not engine activity: activity is what ONE tab's engine does; the group
 * is what the TASK needs from a person. Tab signals made a permission-stalled
 * worker and an approved PR both read as ordinary work in progress.
 */

import type { TaskEngineState } from "@/client/remote-orchestrator"
import { type TaskGroup, deriveTaskGroup, taskGroupRank } from "@/lib/task-group"
import { t } from "@/tui/i18n"
import type { Task } from "@/types/task"
import { compareRecent } from "./groups"
import type { SidebarTone } from "./row-view"

/**
 * `tabAlive: null` (could not ask) on purpose: a pane lacks the pty host's
 * session inventory. The CLI `context` verb, holding `pty.list`, supplies it.
 */
export function taskGroupIn(task: Task, activity: TaskEngineState | undefined, now: number = Date.now()): TaskGroup {
  return deriveTaskGroup({ task, activity, tabAlive: null, now })
}

/** `null` for `idle`/`unknown`. Call at render time so `t()` stays reactive. */
export function taskGroupLabel(group: TaskGroup): string | null {
  switch (group) {
    case "waiting-on-you":
      return t("tasks.group.waitingOnYou")
    case "landing":
      return t("tasks.group.landing")
    case "ready-for-review":
      return t("tasks.group.readyForReview")
    case "working":
      return t("tasks.group.working")
    default:
      return null
  }
}

/** `working` is the accent: progress, not a problem. */
export function taskGroupTone(group: TaskGroup): SidebarTone | "accent" | null {
  switch (group) {
    case "waiting-on-you":
      return "error"
    case "landing":
      return "success"
    case "ready-for-review":
      return "primary"
    case "working":
      return "accent"
    default:
      return null
  }
}

/**
 * `attention` sort: group rank, then most recent. `now` is captured ONCE per
 * sort: a debounce boundary crossed mid-sort makes the comparator inconsistent.
 */
export function compareTaskGroup(
  activityOf: (taskId: string) => TaskEngineState | undefined,
  now: number = Date.now(),
): (a: Task, b: Task) => number {
  const rankOf = (task: Task): number => taskGroupRank(taskGroupIn(task, activityOf(task.id), now))
  return (a, b) => {
    const byGroup = rankOf(a) - rankOf(b)
    // Reuse `compareRecent` so "recent" matches `recent` sort and the Inbox.
    return byGroup !== 0 ? byGroup : compareRecent(a, b)
  }
}
