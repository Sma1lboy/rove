/** @jsxImportSource @opentui/react */
/**
 * The tree's routine fold row. Its own module because it summarises whole
 * TASKS (the task rollup), which the tab-row module must never read.
 */

import type { TaskEngineState } from "@/client/remote-orchestrator"
import type { Task } from "@/types/task"
import { charWidth, displayWidth } from "../../../lib/display-width"
import { truncateEndCells } from "../../../tui/lib/truncate"
import { countWaitingOnYou } from "../../../tui/panes/sidebar/task-group-view"
import { useTheme } from "../../context/theme"
import { useT } from "../../i18n"
import { useClockTick } from "./row-cards"
import { RowShell, type TreeRowShared, treeLabelBudget } from "./tree-row-shell"

/**
 * A project's routine count row, the tree's one fold: schedule output is
 * noise beside tasks a human opened. Open, they render as ordinary worktree
 * rows; closed, they stay reachable from the Inbox and Routines page, and the
 * row still names how many are blocked on you so a stalled routine can't hide.
 */
export function RoutinesTreeRow(props: {
  readonly rowId: string
  readonly flatIndex: number
  readonly count: number
  readonly tasks: readonly Task[]
  readonly expanded: boolean
  readonly shared: TreeRowShared
}) {
  const { theme } = useTheme()
  const t = useT()
  const engineState = props.shared.engineState
  const activityOf = (taskId: string) => engineState?.get(taskId)
  // `error`/`dead` only become "needs you" after a settle window, which no
  // engine event marks: tick the poll clock while one is pending.
  const settling = !props.expanded && props.tasks.some((task) => isSettlingActivity(activityOf(task.id)?.state))
  useClockTick(settling)
  const waiting = props.expanded ? 0 : countWaitingOnYou(props.tasks, activityOf)
  const chip = waiting > 0 ? ` · ${t("tasks.group.waitingOnYou")}: ${waiting}` : ""
  // The count yields to the chip: the chip is the part that asks you to act.
  const label = truncateEndCells(
    t("tasks.routinesRow", { count: String(props.count) }),
    treeLabelBudget(props.shared, 2 + displayWidth(chip)),
    charWidth,
  )
  return (
    <RowShell rowId={props.rowId} flatIndex={props.flatIndex} depth={1} shared={props.shared}>
      {/* A 2-cell twisty is terminal grammar for "this opens", the same
          fixed-glyph exception the diff gutter takes. */}
      <text fg={theme.textMuted} wrapMode="none" width={2} flexShrink={0}>
        {props.expanded ? "▾ " : "▸ "}
      </text>
      <text fg={theme.textMuted} wrapMode="none" flexShrink={1}>
        {label}
      </text>
      {chip ? (
        <text fg={theme.error} wrapMode="none" flexShrink={0}>
          {chip}
        </text>
      ) : null}
    </RowShell>
  )
}

function isSettlingActivity(state: TaskEngineState["state"] | undefined): boolean {
  return state === "error" || state === "dead"
}
