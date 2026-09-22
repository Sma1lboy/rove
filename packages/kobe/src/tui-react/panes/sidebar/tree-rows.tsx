/** @jsxImportSource @opentui/react */
/**
 * Tree rows: project header flush, worktrees one cell in, tab rows at the
 * SAME column as their worktree (the state glyph carries the hierarchy). A
 * worktree row is `[job spinner] · label` plus the right-edge cluster and
 * stays ONE cell tall: a dozen worktrees must fit the rail.
 *
 * An AGENT tab row can opt in to a second cell naming the live engine
 * (`state/tab-row-height.ts`, off by default: it roughly halves how many rows
 * fit). Non-agent tabs stay one cell.
 */

import { type TaskEngineState, type TaskJobState, liveRowTokens } from "@/client/remote-orchestrator"
import type { Task } from "@/types/task"
import { TextAttributes } from "@opentui/core"
import { useEffect, useMemo } from "react"
import { engineDisplayName } from "../../../engine/interactive-command"
import { charWidth } from "../../../lib/display-width"
import { relativeAge } from "../../../lib/relative-time"
import { TAB_ROW_HEIGHT_KEY, normalizeTabRowHeight } from "../../../state/tab-row-height"
import { truncateEndCells } from "../../../tui/lib/truncate"
import { currentBranch, pollCurrentBranch } from "../../../tui/panes/sidebar/git-head"
import { prChip } from "../../../tui/panes/sidebar/row-chips"
import {
  ATTENTION_GLYPH,
  IN_PROGRESS_SPINNER,
  NO_STATE_GLYPH,
  buildSidebarRowView,
  isAttentionActivity,
  withSpinnerFrame,
} from "../../../tui/panes/sidebar/row-view"
import { type TreeTab, rowLiveBranchPath, tabRowActivity, worktreeRowLabel } from "../../../tui/panes/sidebar/tree-core"
import { rowTokenTone, toneColor, truncateBranchLabel } from "../../../tui/panes/sidebar/view-core"
import { useOptionalKV } from "../../context/kv"
import { useTheme } from "../../context/theme"
import { useT } from "../../i18n"
import {
  ChangeStats,
  UNKNOWN_CHANGES_MARK,
  completionSeenFor,
  completionStampOf,
  useChanges,
  useDonePulse,
  useDurableCompletionSeen,
  useSpinnerFrame,
} from "./row-cards"
import { MoveChip, RowShell, type TreeRowShared, clusterCells, treeLabelBudget } from "./tree-row-shell"

/**
 * Age in the current state (`12m`) for WORKING or STOPPED rows only; null
 * otherwise, or every idle tab would wear a number. No timer: the ~2s branch
 * tick re-renders the tree, and this sits outside `useTabRowBaseView`'s memo.
 */
function activityAgeLabel(activity: TaskEngineState | undefined, loading: boolean): string | null {
  if (activity === undefined) return null
  if (!loading && !isAttentionActivity(activity.state)) return null
  // `relativeAge` clamps a clock skewed ahead of the daemon to `0s`.
  return relativeAge(activity.at)
}

/**
 * A worktree row carries NO engine state glyph (that lives on the tab row);
 * only worktree-level facts: branch, pin, PR chip, ±stats, and
 * materializing/deleting.
 *
 * Both jobs must show HERE: a materializing task has no tab rows yet (a tab
 * is recorded only once delivery succeeds), and `TaskDeletionCoordinator`
 * sweeps PTYs before touching the worktree, so a failed deletion has no tab
 * or activity to carry a `!`.
 *
 * Reads `taskJobs` DIRECTLY, not `buildSidebarRowView`'s `loading`, which
 * folds in engine activity and would leak the task rollup onto this row. A
 * job is task-scoped (one per taskId, one worktree per task).
 */
export function WorktreeTreeRow(props: {
  readonly rowId: string
  readonly flatIndex: number
  readonly task: Task
  /** Tree depth — 1 at rest, one deeper under a machine header. */
  readonly depth?: number
  readonly shared: TreeRowShared
}) {
  const { theme } = useTheme()
  const t = useT()
  const shared = props.shared
  const task = props.task
  const changes = useChanges(shared, task)
  const chip = prChip(task)
  // Named by BRANCH (`worktreeRowLabel`). Main checkouts and directory/scratch
  // tasks store none and move freely, so they poll their own HEAD.
  const livePath = rowLiveBranchPath(task)
  useEffect(() => {
    // Re-poll on the sidebar's ~2s tick.
    void shared.branchTick
    if (livePath) pollCurrentBranch(livePath)
  }, [livePath, shared.branchTick])
  const label = worktreeRowLabel(task, livePath ? { liveBranch: currentBranch(livePath) } : {})
  const moving = shared.movingRowId === props.rowId
  // Presence in the map IS "running" — the daemon removes the entry on both
  // terminal phases (see `TaskJobState`).
  const materializing = shared.taskJobs?.get(task.id) !== undefined
  // Task-scoped like `taskJobs`, so read directly.
  const deletionPhase = task.deletion?.phase
  const deleting = deletionPhase === "queued" || deletionPhase === "running"
  const deleteFailed = deletionPhase === "error"
  const spinning = materializing || deleting
  const frame = useSpinnerFrame(spinning)
  // Rides beside the branch label, not in place of it: a failed deletion
  // leaves the branch, and rows all reading "delete failed" are unusable.
  const deletionWord =
    deleting || deleteFailed ? t(deleteFailed ? "tasks.subtitle.deleteFailed" : "tasks.subtitle.deleting") : null
  // Expired plugin tokens drop at RENDER time too, before the daemon's republish.
  const tokens = liveRowTokens(shared.rowTokens, task.id, Date.now())
  const reserved =
    // The glyph column exists only while a job runs.
    (spinning ? 2 : 0) +
    // A plugin can crowd the branch name but never overflow the row.
    tokens.reduce((cells, token) => cells + clusterCells(token.text), 0) +
    (deletionWord ? clusterCells(deletionWord) : 0) +
    (task.pinned === true ? 2 : 0) +
    (chip ? 2 : 0) +
    // The unknown mark replaces the whole ↑/+/−/↓ cluster.
    (changes === null ? clusterCells(UNKNOWN_CHANGES_MARK) : 0) +
    ((changes?.ahead ?? 0) > 0 ? clusterCells(`↑${changes?.ahead}`) : 0) +
    ((changes?.added ?? 0) > 0 ? clusterCells(`+${changes?.added}`) : 0) +
    ((changes?.deleted ?? 0) > 0 ? clusterCells(`−${changes?.deleted}`) : 0) +
    ((changes?.behind ?? 0) > 0 ? clusterCells(`↓${changes?.behind}`) : 0) +
    (moving ? clusterCells(t("tasks.moveChip").trim()) : 0)
  return (
    <RowShell rowId={props.rowId} flatIndex={props.flatIndex} depth={props.depth ?? 1} shared={shared}>
      {spinning ? (
        <text fg={theme.primary} wrapMode="none" width={2} flexShrink={0}>
          {`${IN_PROGRESS_SPINNER[frame % IN_PROGRESS_SPINNER.length] ?? IN_PROGRESS_SPINNER[0]} `}
        </text>
      ) : null}
      <box flexDirection="row" flexGrow={1} paddingRight={1} gap={1}>
        {/* A row from an unreachable machine is the LAST KNOWN state, not a
            live one — it keeps its place and drops to muted rather than
            disappearing, which would erase the only record of where the work
            is. */}
        <text
          fg={task.origin?.stale ? theme.textMuted : theme.text}
          wrapMode="none"
          flexBasis={0}
          flexGrow={1}
          flexShrink={1}
        >
          {truncateEndCells(label, treeLabelBudget(shared, reserved), charWidth)}
        </text>
        {task.pinned === true ? (
          <text fg={theme.warning} wrapMode="none" flexShrink={0}>
            ▴
          </text>
        ) : null}
        {chip ? (
          <text fg={toneColor(theme, chip.tone)} wrapMode="none" flexShrink={0}>
            {chip.glyph}
          </text>
        ) : null}
        {tokens.map((token) => (
          <text
            key={`${token.source}\u0000${token.key}`}
            fg={token.tone ? toneColor(theme, rowTokenTone(token.tone)) : theme.textMuted}
            wrapMode="none"
            flexShrink={0}
          >
            {token.text}
          </text>
        ))}
        <ChangeStats changes={changes} />
        {deletionWord ? (
          <text fg={deleteFailed ? theme.error : theme.textMuted} wrapMode="none" flexShrink={0}>
            {deletionWord}
          </text>
        ) : null}
        <MoveChip rowId={props.rowId} shared={shared} />
      </box>
    </RowShell>
  )
}

/**
 * The tab row's `buildSidebarRowView`, memoized on the real inputs so the
 * ~10Hz spinner tick doesn't re-derive idle rows. Exported for its memo test.
 */
export function useTabRowBaseView(args: {
  readonly task: Task
  readonly activity: TaskEngineState | undefined
  readonly lifecycle: { readonly subagents: number } | undefined
  readonly job: TaskJobState | undefined
  readonly completionSeen: boolean
}): ReturnType<typeof buildSidebarRowView> {
  const t = useT()
  const { task, activity, lifecycle, job, completionSeen } = args
  return useMemo(() => {
    // Rebuild on language change: buildSidebarRowView reads the global `t`.
    void t
    return buildSidebarRowView({
      task,
      activity,
      lifecycle,
      job,
      spinnerFrame: 0,
      subtitleBudget: 0,
      truncateBranch: truncateBranchLabel,
      completionSeen,
    })
  }, [task, activity, lifecycle, job, completionSeen, t])
}

export function TabTreeRow(props: {
  readonly rowId: string
  readonly flatIndex: number
  readonly task: Task
  readonly tab: TreeTab
  /** Tree depth — 1 at rest, one deeper under a machine header. */
  readonly depth?: number
  readonly shared: TreeRowShared
}) {
  const { theme } = useTheme()
  const t = useT()
  const shared = props.shared
  // Only an AGENT tab with daemon-reported activity wears a live state glyph.
  const isAgent = props.tab.engine === true
  const taskTabStates = isAgent ? shared.engineTabState?.get(props.task.id) : undefined
  const activity = isAgent ? tabRowActivity({ tabId: props.tab.id, tabActivities: taskTabStates }) : undefined
  // Own activity only; counting "is the active tab" would leak the task rollup.
  const carriesState = activity !== undefined
  // Sitting in the tab digests ● to ✓ on the same render. ONLY a row carrying
  // activity may run the bookkeeping: a sibling's state=undefined would wipe
  // the bit the active row just recorded (✓ → ● flip on task switch).
  const viewing = shared.selectedTaskId === props.task.id && props.tab.active === true
  // The durable half survives a restart, as the daemon's activity entry does.
  const durableSeen = useDurableCompletionSeen(
    props.task.id,
    props.tab.id,
    carriesState ? completionStampOf(activity) : undefined,
    viewing,
  )
  const completionSeen = carriesState
    ? completionSeenFor(props.task.id, activity?.state, viewing, props.tab.id, durableSeen)
    : false
  const baseView = useTabRowBaseView({
    task: props.task,
    activity,
    lifecycle: carriesState ? shared.engineLifecycle?.get(props.task.id) : undefined,
    job: carriesState ? shared.taskJobs?.get(props.task.id) : undefined,
    completionSeen,
  })
  const frame = useSpinnerFrame(carriesState && baseView.loading)
  const rowView = withSpinnerFrame(baseView, () => frame)
  // A freeze-restored tab's process is dead and OPENING it re-runs the launch
  // command, first prompt and all. It must not read `○` ("nothing to do");
  // it takes the dead-engine `!`.
  const restored = props.tab.restored === true
  // No daemon signal rests at the same `○` as known-idle. See NO_STATE_GLYPH.
  const glyph = restored ? ATTENTION_GLYPH : isAgent && carriesState ? rowView.stateGlyph : NO_STATE_GLYPH
  const age = carriesState ? activityAgeLabel(activity, rowView.loading) : null
  // Gated on `carriesState`, or a sibling would flash for another tab's turn.
  const pulsing = useDonePulse(carriesState ? completionStampOf(activity) : undefined)
  // Second line, agent tabs only: the engine RUNNING, probed from the pty's
  // process tree (`TreeTab.liveVendor`), not task config (usually unset).
  // No answer → no second line. No KV provider → default height.
  const kv = useOptionalKV()
  const twoCell = normalizeTabRowHeight(kv?.get(TAB_ROW_HEIGHT_KEY, 1)) === 2
  const liveVendor = props.tab.liveVendor ?? null
  const modelLine = isAgent && twoCell && liveVendor ? engineDisplayName(liveVendor) : null
  return (
    <RowShell rowId={props.rowId} flatIndex={props.flatIndex} depth={props.depth ?? 1} shared={props.shared}>
      <text
        fg={
          pulsing
            ? theme.success
            : restored
              ? theme.error
              : carriesState
                ? toneColor(theme, rowView.tone)
                : theme.textMuted
        }
        attributes={pulsing ? TextAttributes.BOLD : undefined}
        wrapMode="none"
        width={2}
        flexShrink={0}
      >
        {`${glyph} `}
      </text>
      <box flexDirection="column" flexGrow={1}>
        <box flexDirection="row" paddingRight={1} gap={1}>
          <text
            fg={pulsing ? theme.text : theme.textMuted}
            attributes={pulsing ? TextAttributes.BOLD : undefined}
            wrapMode="none"
            flexBasis={0}
            flexGrow={1}
            flexShrink={1}
          >
            {truncateEndCells(
              props.tab.label,
              // + the 2-cell state-glyph column.
              treeLabelBudget(
                shared,
                2 +
                  (age ? clusterCells(age) : 0) +
                  (shared.movingRowId === props.rowId ? clusterCells(t("tasks.moveChip").trim()) : 0),
              ),
              charWidth,
            )}
          </text>
          {age ? (
            <text fg={theme.textMuted} attributes={TextAttributes.DIM} wrapMode="none" flexShrink={0}>
              {age}
            </text>
          ) : null}
          <MoveChip rowId={props.rowId} shared={shared} />
        </box>
        {modelLine ? (
          // Flush with the title (owner call): the pair reads as one block.
          <text fg={theme.textMuted} attributes={TextAttributes.DIM} wrapMode="none" paddingRight={1}>
            {truncateEndCells(modelLine, treeLabelBudget(shared, 2), charWidth)}
          </text>
        ) : null}
      </box>
    </RowShell>
  )
}

/**
 * A project's routine count row, the tree's one fold: schedule output is
 * noise beside tasks a human opened. Open, they render as ordinary worktree
 * rows; closed, they stay reachable from the Inbox and Routines page.
 */
export function RoutinesTreeRow(props: {
  readonly rowId: string
  readonly flatIndex: number
  readonly count: number
  readonly expanded: boolean
  readonly shared: TreeRowShared
}) {
  const { theme } = useTheme()
  const t = useT()
  return (
    <RowShell rowId={props.rowId} flatIndex={props.flatIndex} depth={1} shared={props.shared}>
      {/* A 2-cell twisty is terminal grammar for "this opens", the same
          fixed-glyph exception the diff gutter takes. */}
      <text fg={theme.textMuted} wrapMode="none" width={2} flexShrink={0}>
        {props.expanded ? "▾ " : "▸ "}
      </text>
      <text fg={theme.textMuted} wrapMode="none" flexShrink={1}>
        {t("tasks.routinesRow", { count: String(props.count) })}
      </text>
    </RowShell>
  )
}

/** Narrow mode's "↩ Recent: <task>" row: ⏎ re-enters that task; no menu, no verbs. */
export function RecentJumpRow(props: {
  readonly rowId: string
  readonly flatIndex: number
  readonly task: Task
  readonly shared: TreeRowShared
}) {
  const { theme } = useTheme()
  const t = useT()
  return (
    <RowShell rowId={props.rowId} flatIndex={props.flatIndex} depth={1} shared={props.shared}>
      <text fg={theme.accent} wrapMode="none" width={2} flexShrink={0}>
        {"↩ "}
      </text>
      <text fg={theme.text} wrapMode="none" flexShrink={1}>
        {t("tasks.recentJump", { title: props.task.title })}
      </text>
    </RowShell>
  )
}
