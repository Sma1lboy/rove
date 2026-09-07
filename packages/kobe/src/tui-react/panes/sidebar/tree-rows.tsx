/** @jsxImportSource @opentui/react */
/**
 * One-line tree rows: every row inside the tree is ONE cell tall — project
 * header flush, worktrees one cell in, and tab rows at the SAME column as
 * their worktree (the state-circle glyph carries the hierarchy, so extra
 * indent only costs the narrow rail width). Density is the point (a dozen
 * worktrees × tabs must fit the rail), so a worktree row is
 * `twisty · state glyph · title` plus the right-edge cluster
 * (pin / PR chip / ±stats / jump digit).
 */

import type { TaskEngineState, TaskJobState } from "@/client/remote-orchestrator"
import type { Task } from "@/types/task"
import { type BoxRenderable, MouseButton, TextAttributes } from "@opentui/core"
import { type ReactNode, useEffect, useMemo } from "react"
import { charWidth } from "../../../lib/display-width"
import { relativeAge } from "../../../lib/relative-time"
import { truncateEndCells } from "../../../tui/lib/truncate"
import { currentBranch, pollCurrentBranch } from "../../../tui/panes/sidebar/git-head"
import { taskJumpDigit } from "../../../tui/panes/sidebar/jump-digits"
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
import { SIDEBAR_WIDTH, toneColor, truncateBranchLabel } from "../../../tui/panes/sidebar/view-core"
import type { WorktreeChanges } from "../../../tui/panes/sidebar/worktree-changes"
import { useTheme } from "../../context/theme"
import { useT } from "../../i18n"
import {
  ChangeStats,
  JumpDigit,
  UNKNOWN_CHANGES_MARK,
  completionSeenFor,
  completionStampOf,
  useChanges,
  useDonePulse,
  useDurableCompletionSeen,
  useSpinnerFrame,
} from "./row-cards"
import { MoveChip, RowShell, type TreeRowShared, clusterCells, jumpDigitCells, treeLabelBudget } from "./tree-row-shell"

/**
 * How long this tab has been in its current state — `12m`, `2h` — or null
 * when the state is one nobody is waiting on.
 *
 * Shown for exactly two readings: a row that is WORKING (how long has it been
 * at it) and a row that is STOPPED (how long has it been stuck). A quiet row
 * gets nothing: `○` already means there is nothing to wait for, and dating it
 * would put a number on every idle tab in the rail.
 *
 * No timer of its own. The tree re-renders on the sidebar's ~2s branch tick
 * (`shared.branchTick`), so the age walks by itself, and this stays outside
 * `useTabRowBaseView`'s memo so an idle row still rebuilds nothing.
 */
function activityAgeLabel(activity: TaskEngineState | undefined, loading: boolean): string | null {
  if (activity === undefined) return null
  if (!loading && !isAttentionActivity(activity.state)) return null
  // A clock skewed ahead of the daemon would otherwise print a huge age; the
  // clamp inside `relativeAge` turns that into `0s`, which reads as "just
  // now" rather than as a wrong number.
  return relativeAge(activity.at)
}

/**
 * A worktree row carries NO ENGINE state glyph: the session state belongs to
 * the chat tab that runs it, so that glyph lives on the tab row below. What
 * stays here is worktree-level fact — branch, pin, PR chip, ±change stats —
 * and a worktree being MATERIALIZED or DELETED is the most worktree-level
 * fact there is.
 *
 * Deletion has to be read here for the same reason materialization is, only
 * more sharply: `TaskDeletionCoordinator` sweeps the task's PTYs before it
 * touches the worktree, so by the time a deletion fails the task has no
 * activity entry and no live tab — the tab row that would carry a `!` is
 * gated on activity it can never have again. A failed deletion left the row
 * indistinguishable from a healthy one, discoverable only through
 * `rove api list`.
 *
 * Why the job spinner has to live here rather than on the tab row: during
 * `git worktree add` a freshly created task has no engine activity (the engine
 * has not started) and no tab rows at all (a tab is only recorded once
 * delivery succeeds). The tab row that would render the job is therefore the
 * one row that does not yet exist — without this, `rove api add --count 5` on
 * a big repo leaves frozen `(new task)` rows for the whole minutes-long
 * materialization while the daemon publishes `task.jobs {phase:"running"}`.
 *
 * It reads `taskJobs` DIRECTLY and nothing else — deliberately not through
 * `buildSidebarRowView`, whose `loading` also folds in engine activity. Taking
 * the derived flag would put the task-level activity rollup back on the
 * worktree row, which is the leak the tab row's `carriesState` gate exists to
 * stop. A job is genuinely task-scoped (the daemon publishes one entry per
 * taskId, and a task has exactly one worktree), so it is the one signal a
 * worktree row may read without a tab to attribute it to.
 */
export function WorktreeTreeRow(props: {
  readonly rowId: string
  readonly flatIndex: number
  readonly task: Task
  readonly shared: TreeRowShared
}) {
  const { theme } = useTheme()
  const t = useT()
  const shared = props.shared
  const task = props.task
  const isCursor = shared.cursorIndex === props.flatIndex
  const changes = useChanges(shared, task)
  const chip = prChip(task)
  // A worktree row is named by its BRANCH; branchless rows fall back to
  // their tail-truncated path (the one derivation rule —
  // `worktreeRowLabel`). Which rows have to LOOK UP that branch is
  // `rowLiveBranchPath`: main checkouts and directory/scratch tasks store
  // none and move freely, so they poll their own HEAD.
  const livePath = rowLiveBranchPath(task)
  useEffect(() => {
    // Dependency-only invalidation key: re-poll on the sidebar's ~2s tick.
    void shared.branchTick
    if (livePath) pollCurrentBranch(livePath)
  }, [livePath, shared.branchTick])
  const label = worktreeRowLabel(task, livePath ? { liveBranch: currentBranch(livePath) } : {})
  const moving = shared.movingRowId === props.rowId
  // Presence in the map IS "running" — the daemon removes the entry on both
  // terminal phases (see `TaskJobState`).
  const materializing = shared.taskJobs?.get(task.id) !== undefined
  // Read `task.deletion` directly, the same way `taskJobs` is read and for
  // the same reason: it is genuinely task-scoped (one deletion per task, one
  // worktree per task), so it needs no tab to attribute it to.
  const deletionPhase = task.deletion?.phase
  const deleting = deletionPhase === "queued" || deletionPhase === "running"
  const deleteFailed = deletionPhase === "error"
  const spinning = materializing || deleting
  const frame = useSpinnerFrame(spinning)
  // The word the deletion states caption themselves with. A failed deletion
  // leaves the worktree and the branch untouched, so the branch label stays
  // and the word rides beside it rather than replacing it — with seven
  // stalled deletions in one project, rows that all read "delete failed"
  // and nothing else would be unusable.
  const deletionWord =
    deleting || deleteFailed ? t(deleteFailed ? "tasks.subtitle.deleteFailed" : "tasks.subtitle.deleting") : null
  const reserved =
    // The glyph column exists only while a job runs or a deletion is in
    // flight, so a quiet row spends none of its label budget on it.
    (spinning || deleteFailed ? 2 : 0) +
    (deletionWord ? clusterCells(deletionWord) : 0) +
    jumpDigitCells(props.flatIndex) +
    (task.pinned === true ? 2 : 0) +
    (chip ? 2 : 0) +
    // `changes === null` is the unknown mark, one cell like any chip glyph —
    // it replaces the whole ↑/+/−/↓ cluster rather than sitting beside it.
    (changes === null ? clusterCells(UNKNOWN_CHANGES_MARK) : 0) +
    ((changes?.ahead ?? 0) > 0 ? clusterCells(`↑${changes?.ahead}`) : 0) +
    ((changes?.added ?? 0) > 0 ? clusterCells(`+${changes?.added}`) : 0) +
    ((changes?.deleted ?? 0) > 0 ? clusterCells(`−${changes?.deleted}`) : 0) +
    ((changes?.behind ?? 0) > 0 ? clusterCells(`↓${changes?.behind}`) : 0) +
    (moving ? clusterCells(t("tasks.moveChip").trim()) : 0)
  return (
    <RowShell rowId={props.rowId} flatIndex={props.flatIndex} depth={1} shared={shared}>
      {spinning ? (
        <text fg={theme.primary} wrapMode="none" width={2} flexShrink={0}>
          {`${IN_PROGRESS_SPINNER[frame % IN_PROGRESS_SPINNER.length] ?? IN_PROGRESS_SPINNER[0]} `}
        </text>
      ) : deleteFailed ? (
        <text fg={theme.error} wrapMode="none" width={2} flexShrink={0}>
          {`${ATTENTION_GLYPH} `}
        </text>
      ) : null}
      <box flexDirection="row" flexGrow={1} paddingRight={1} gap={1}>
        <text fg={theme.text} wrapMode="none" flexBasis={0} flexGrow={1} flexShrink={1}>
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
        <ChangeStats changes={changes} />
        {deletionWord ? (
          <text fg={deleteFailed ? theme.error : theme.textMuted} wrapMode="none" flexShrink={0}>
            {deletionWord}
          </text>
        ) : null}
        <MoveChip rowId={props.rowId} shared={shared} />
        <JumpDigit flatIndex={props.flatIndex} dim={!isCursor} />
      </box>
    </RowShell>
  )
}

/**
 * The tab row's `buildSidebarRowView`, memoized on the real inputs so the
 * ~10Hz spinner tick (a fresh `shared` object every render) doesn't
 * re-derive idle tab rows: non-loading rows come back as the same object and
 * never subscribe to the tick. Exported so the memo contract has a direct
 * test; TabTreeRow is the only caller.
 */
export function useTabRowBaseView(args: {
  readonly task: Task
  readonly activity: TaskEngineState | undefined
  readonly lifecycle: { readonly subagents: number } | undefined
  readonly job: TaskJobState | undefined
  /** This worktree's transcript facts — what keeps a `turn_complete` whose
   *  engine is still writing from settling to done (`row-view.ts`). */
  readonly transcript: { readonly mtimeMs: number } | undefined
  readonly completionSeen: boolean
}): ReturnType<typeof buildSidebarRowView> {
  const t = useT()
  const { task, activity, lifecycle, job, transcript, completionSeen } = args
  return useMemo(() => {
    // Dependency-only invalidation key: rebuild when the language changes —
    // buildSidebarRowView reads the global `t` through the locale store.
    void t
    return buildSidebarRowView({
      task,
      activity,
      lifecycle,
      job,
      transcript,
      spinnerFrame: 0,
      subtitleBudget: 0,
      truncateBranch: truncateBranchLabel,
      completionSeen,
    })
  }, [task, activity, lifecycle, job, transcript, completionSeen, t])
}

export function TabTreeRow(props: {
  readonly rowId: string
  readonly flatIndex: number
  readonly task: Task
  readonly tab: TreeTab
  readonly shared: TreeRowShared
}) {
  const { theme } = useTheme()
  const t = useT()
  const shared = props.shared
  const isCursor = shared.cursorIndex === props.flatIndex
  // Glyph rule: an AGENT tab wears the live state glyph when the daemon
  // reports activity for its session; a non-agent tab (shell/command/content)
  // or one with no signal rests at `○`.
  const isAgent = props.tab.engine === true
  // Prefer THIS tab's own activity over the task rollup. The daemon reports
  // both levels, but the task entry is last-event-wins across every tab — so
  // a task whose live work is in tab-2 would read as whatever tab-N reported
  // most recently, leaving a genuinely running row at `○` until you open it.
  // Tab-level is the precise answer; the rollup stays the fallback for
  // sessions kobe didn't spawn as a tab (a hand-typed `claude` in a shell
  // reports task-level only — see the `engine-state` channel contract).
  const taskTabStates = isAgent ? shared.engineTabState?.get(props.task.id) : undefined
  // Rule (and the reason the rollup is gated) lives in `tabRowActivity`.
  const activity = isAgent
    ? tabRowActivity({
        tabActivity: taskTabStates?.get(props.tab.id),
        reportedTabCount: taskTabStates?.size ?? 0,
        taskActivity: shared.engineState?.get(props.task.id),
        active: props.tab.active === true,
      })
    : undefined
  // One predicate: "does this row have activity of its own". Also counting
  // "is the active tab" is what lets the task rollup leak in.
  const carriesState = activity !== undefined
  // The unread lamp (herdr ● on turn_complete) is for sessions you are NOT
  // looking at — sitting in the tab digests it to ✓ on the same render.
  // "Viewing" = this row's TASK is selected and this tab is the task's
  // active one. ONLY the row that carries the task's activity may run the
  // bookkeeping: a sibling tab passes state=undefined, and letting it call
  // would fire the delete branch and wipe the seen bit the active row just
  // recorded — the ✓ → ● → ✓ flip on every task switch.
  const viewing = shared.selectedTaskId === props.task.id && props.tab.active === true
  // Per-TAB seen bit: sibling tab rows of the same task render in this very
  // pass and would otherwise share (and clear) one task-wide mark. The
  // durable half survives a kobe restart, which the daemon's activity entry
  // does too — without it every already-read completion comes back ●.
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
    // Keyed by worktree path, which is all the daemon collects — so every tab
    // of a task shares one transcript. That is the resolution available: the
    // alternative is the pre-fix behaviour where a nine-minute tool call
    // after `turn-complete` rendered as done.
    transcript: shared.transcriptActivity?.get(props.task.worktreePath),
    completionSeen,
  })
  const frame = useSpinnerFrame(carriesState && baseView.loading)
  const rowView = withSpinnerFrame(baseView, () => frame)
  // A freeze-restored tab is a corpse the pty host kept the scrollback for:
  // its process died with the host, and OPENING it silently re-runs the
  // recorded launch command — first prompt and all. Headless delivery refuses
  // that without `--respawn` (TAB_RESTORED); the TUI just does it. Until the
  // banner lands, the row at least has to stop reading `○`, which is the one
  // glyph that means "nothing to do here". It is a dead engine process, so it
  // takes the `!` the rail already spends on exactly that.
  const restored = props.tab.restored === true
  // With NO daemon signal at all (fresh daemon before its first observer pass,
  // dead daemon lineage) the row rests at the same `○` a known-idle one does —
  // both readings send you into the tab to find out. See NO_STATE_GLYPH.
  const glyph = restored ? ATTENTION_GLYPH : isAgent && carriesState ? rowView.stateGlyph : NO_STATE_GLYPH
  const age = carriesState ? activityAgeLabel(activity, rowView.loading) : null
  // The landing flash. Gated on `carriesState` for the same reason the seen
  // bit is: a sibling row passing the task rollup would flash for a turn that
  // finished in another tab.
  const pulsing = useDonePulse(carriesState ? completionStampOf(activity) : undefined)
  // depth 1, not 2: a tab row starts at the same column as its
  // worktree row — the circle status glyph carries the hierarchy, and the
  // extra indent cell wasted width the narrow rail doesn't have.
  return (
    <RowShell rowId={props.rowId} flatIndex={props.flatIndex} depth={1} shared={props.shared}>
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
      <box flexDirection="row" flexGrow={1} paddingRight={1} gap={1}>
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
            // The 2-cell state-glyph column is this row's extra fixed spend.
            treeLabelBudget(
              shared,
              2 +
                jumpDigitCells(props.flatIndex) +
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
        <JumpDigit flatIndex={props.flatIndex} dim={!isCursor} />
      </box>
    </RowShell>
  )
}

/**
 * A project's routine count row — the one fold in this tree.
 *
 * Standing routine sessions rest behind it because a schedule's output is
 * background noise beside the tasks the user opened themselves. ⏎ (or a
 * click) toggles it open, and the tasks then render as ordinary worktree
 * rows: the fold hides them, it never turns them into a different kind of
 * thing. They stay selectable from the Inbox and the Routines page while
 * closed, so this hides a ROW, not a task.
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

/**
 * Narrow mode's "↩ Recent: <task>" jump row — the first
 * navigable row of the narrow sidebar. ⏎ re-enters the named task's
 * workspace; it answers to nothing else (no menu, no per-task verbs).
 */
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
