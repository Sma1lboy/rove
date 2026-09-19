/**
 * Presentation of the DERIVED task group (`lib/task-group.ts`) — the one
 * place the TUI turns "whose turn is it" into a tone, a label and a sort key.
 * One module so the board badge and the rail's `attention` sort cannot
 * disagree about what `waiting-on-you` means.
 *
 * Deliberately NOT a row glyph: the sidebar rail draws no task-level marker
 * (owner 2026-09-19). Engine state on a tab row and a task rollup on the
 * worktree row above it are two different vocabularies sharing one column,
 * and the rail reads as a legend when both are lit.
 *
 * Why the group and not raw engine activity: activity describes what ONE tab's
 * engine is doing. The group describes what the TASK needs from a person, and
 * that is the question every surface here was already trying to answer with a
 * tab-level signal — which is why a worker whose engine died at a permission
 * prompt, and a task whose PR was approved an hour ago, both read as ordinary
 * work in progress.
 */

import type { TaskEngineState } from "@/client/remote-orchestrator"
import { type TaskGroup, deriveTaskGroup, taskGroupRank } from "@/lib/task-group"
import { t } from "@/tui/i18n"
import type { Task } from "@/types/task"
import { compareRecent } from "./groups"
import type { SidebarTone } from "./row-view"

/**
 * Derive one task's group from what a TUI pane has in hand.
 *
 * `tabAlive` is passed as `null` (could not ask) on purpose: a pane has the
 * daemon's activity map, not the pty host's session inventory, and `null`
 * refutes nothing — exactly the honest reading. The CLI's `context` verb,
 * which does hold a fleet-wide `pty.list`, supplies the real answer.
 */
export function taskGroupIn(task: Task, activity: TaskEngineState | undefined, now: number = Date.now()): TaskGroup {
  return deriveTaskGroup({ task, activity, tabAlive: null, now })
}

/**
 * The group's word, for a surface with room for one (the board badge), or
 * `null` for `idle`/`unknown`. Called at render time so `t()` stays reactive.
 */
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

/** Board/badge tone per group. `working` is the accent (it is progress, not a
 *  problem); the rest share the rail's tones. */
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
 * The `attention` sort mode's comparator: by derived group rank, so the top
 * of the list is what needs a person NEXT, most-recently-touched first inside
 * each group.
 *
 * `now` is captured ONCE for the whole sort rather than read per comparison:
 * a debounce boundary crossing mid-sort would make the comparator
 * inconsistent, which is how a sort produces a different order every time it
 * runs on the same data.
 */
export function compareTaskGroup(
  activityOf: (taskId: string) => TaskEngineState | undefined,
  now: number = Date.now(),
): (a: Task, b: Task) => number {
  const rankOf = (task: Task): number => taskGroupRank(taskGroupIn(task, activityOf(task.id), now))
  return (a, b) => {
    const byGroup = rankOf(a) - rankOf(b)
    // The tiebreak BORROWS `compareRecent` rather than restating it, so
    // "recent" means the same thing here, in `recent` sort, and in the
    // Inbox's RECENT section.
    return byGroup !== 0 ? byGroup : compareRecent(a, b)
  }
}
