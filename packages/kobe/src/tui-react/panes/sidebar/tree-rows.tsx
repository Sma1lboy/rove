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
import { type BoxRenderable, MouseButton } from "@opentui/core"
import { type ReactNode, useEffect, useMemo } from "react"
import { charWidth } from "../../../lib/display-width"
import { truncateEndCells } from "../../../tui/lib/truncate"
import { currentBranch, pollCurrentBranch } from "../../../tui/panes/sidebar/git-head"
import { prChip } from "../../../tui/panes/sidebar/row-chips"
import {
  IN_PROGRESS_SPINNER,
  NO_STATE_GLYPH,
  buildSidebarRowView,
  withSpinnerFrame,
} from "../../../tui/panes/sidebar/row-view"
import { type TreeTab, rowLiveBranchPath, tabRowActivity, worktreeRowLabel } from "../../../tui/panes/sidebar/tree-core"
import { SIDEBAR_WIDTH, toneColor, truncateBranchLabel } from "../../../tui/panes/sidebar/view-core"
import type { WorktreeChanges } from "../../../tui/panes/sidebar/worktree-changes"
import { useTheme } from "../../context/theme"
import { useT } from "../../i18n"
import { resolveRowSelectionChrome } from "../../ui/row-selection-chrome"
import {
  ChangeStats,
  JumpDigit,
  UNKNOWN_CHANGES_MARK,
  completionSeenFor,
  completionStampOf,
  useChanges,
  useDurableCompletionSeen,
  useSpinnerFrame,
} from "./row-cards"

/** Cells of indent per depth level — one: the rail is narrow, and the glyph
 *  column already separates the levels visually. */
const INDENT_CELLS = 1

export type TreeRowShared = {
  /** Rail width in cells — the label truncation budget derives from it. */
  readonly width?: number
  /** Cursor position in the tree's flat id list. */
  readonly cursorIndex: number
  /** The row id the right pane is showing (`taskId::tabId` when a tab). */
  readonly activeRowId: string | null
  /** The task whose session the right pane shows. The unread-lamp digest
   *  keys on THIS (selected task + the tab's own active bit) rather than on
   *  `activeRowId`: that id needs the live tab map, which is cold right
   *  after a restart — and a lamp that ignores the session you are sitting
   *  in is wrong. */
  readonly selectedTaskId: string | null
  /** The row being dragged in move mode — wears the move chip.
   *  Null outside move mode, and while a `main` row drags its whole project
   *  (the group HEADER wears the chip then — `movingProjectId`). */
  readonly movingRowId?: string | null
  /** Keyed by FLAT INDEX so one scroll-follow lookup covers every row. */
  readonly rowEls: Map<number, BoxRenderable>
  readonly onPress: (flatIndex: number, rowId: string) => void
  /** Right-click. Absent = right-click falls through to a plain activate. */
  readonly onContextMenu?: (flatIndex: number, rowId: string, x: number, y: number) => void
  /** The sidebar's ~2s poll tick — drives the ±stats poller. */
  readonly branchTick: number
  readonly engineState?: ReadonlyMap<string, TaskEngineState>
  /** Per-tab activity (taskId → tabId → state) — the precise signal for a
   *  tab row; `engineState` is the task-level rollup fallback. */
  readonly engineTabState?: ReadonlyMap<string, ReadonlyMap<string, TaskEngineState>>
  readonly engineLifecycle?: ReadonlyMap<string, { readonly subagents: number }>
  readonly taskJobs?: ReadonlyMap<string, TaskJobState>
  readonly worktreeChanges?: ReadonlyMap<string, WorktreeChanges | null> | null
}

/**
 * Cell budget for a tree row's flexible label, so a clipped label ends in a
 * visible `…` instead of the bare hard cut Yoga produces (a chopped branch
 * name reads as the full name to anyone who doesn't know it's longer). The
 * caller passes the LIVE right-edge cluster width — same per-row subtraction
 * the flat cards do — and each cluster item costs its width plus its 1-cell
 * flex gap. Slight over-budget is safe (flex still clips); the floor keeps a
 * crowded row from erasing its label entirely.
 */
function treeLabelBudget(shared: TreeRowShared, reserved: number): number {
  const width = shared.width ?? SIDEBAR_WIDTH
  // marker (1) + indent (1) + paddingRight (1) = 3 cells every row spends.
  return Math.max(6, width - 3 - reserved)
}

/** Cells one right-cluster glyph occupies: itself plus the row's 1-cell gap. */
function clusterCells(text: string): number {
  let cells = 1
  for (const ch of text) cells += charWidth(ch.codePointAt(0) ?? 0)
  return cells
}

/** The move-mode chip a dragged ROW wears — same vocabulary as
 *  the project header's chip, so all three levels read identically. */
function MoveChip(props: { readonly rowId: string; readonly shared: TreeRowShared }) {
  const { theme } = useTheme()
  const t = useT()
  if (props.shared.movingRowId !== props.rowId) return null
  return (
    <text fg={theme.info} wrapMode="none" flexShrink={0}>
      {t("tasks.moveChip").trim()}
    </text>
  )
}

function RowShell(props: {
  readonly rowId: string
  readonly flatIndex: number
  readonly depth: number
  readonly shared: TreeRowShared
  readonly children: ReactNode
}) {
  const { theme } = useTheme()
  const shared = props.shared
  const selection = resolveRowSelectionChrome(theme, {
    cursor: shared.cursorIndex === props.flatIndex,
    selected: shared.activeRowId === props.rowId,
  })
  return (
    <box
      ref={(renderable: BoxRenderable | null) => {
        if (!renderable) return
        shared.rowEls.set(props.flatIndex, renderable)
        return () => {
          if (shared.rowEls.get(props.flatIndex) === renderable) shared.rowEls.delete(props.flatIndex)
        }
      }}
      width="100%"
      flexDirection="row"
      gap={0}
      backgroundColor={selection.backgroundColor}
      onMouseUp={(evt: { button: number; x: number; y: number; stopPropagation(): void }) => {
        // Don't bubble to the pane box's focus-grab (the workspace host's
        // sidebar shell): activating a row hands focus to the CONTENT pane,
        // a bubbled sidebar re-grab would overwrite it, leaving the sidebar's
        // letter chords (d!) live over what looks like the terminal. Same
        // guard the ZEN chip carries.
        evt.stopPropagation()
        // Right-click opens the row's menu instead of activating it — the
        // terminal only forwards button 2 while mouse reporting is on, which
        // is the same mode the left-click activate already depends on.
        if (evt.button === MouseButton.RIGHT && shared.onContextMenu) {
          shared.onContextMenu(props.flatIndex, props.rowId, evt.x, evt.y)
          return
        }
        shared.onPress(props.flatIndex, props.rowId)
      }}
    >
      <text fg={selection.markerColor} wrapMode="none">
        {selection.marker}
      </text>
      <text wrapMode="none" flexShrink={0}>
        {" ".repeat(props.depth * INDENT_CELLS)}
      </text>
      {props.children}
    </box>
  )
}

/**
 * A worktree row carries NO ENGINE state glyph: the session state belongs to
 * the chat tab that runs it, so that glyph lives on the tab row below. What
 * stays here is worktree-level fact — branch, pin, PR chip, ±change stats —
 * and a worktree being MATERIALIZED is the most worktree-level fact there is.
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
  const frame = useSpinnerFrame(materializing)
  const reserved =
    // The spinner column exists only while a job runs, so a quiet row spends
    // none of its label budget on it.
    (materializing ? 2 : 0) +
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
      {materializing ? (
        <text fg={theme.primary} wrapMode="none" width={2} flexShrink={0}>
          {`${IN_PROGRESS_SPINNER[frame % IN_PROGRESS_SPINNER.length] ?? IN_PROGRESS_SPINNER[0]} `}
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
  readonly completionSeen: boolean
}): ReturnType<typeof buildSidebarRowView> {
  const t = useT()
  const { task, activity, lifecycle, job, completionSeen } = args
  return useMemo(() => {
    // Dependency-only invalidation key: rebuild when the language changes —
    // buildSidebarRowView reads the global `t` through the locale store.
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
    completionSeen,
  })
  const frame = useSpinnerFrame(carriesState && baseView.loading)
  const rowView = withSpinnerFrame(baseView, () => frame)
  // With NO daemon signal at all (fresh daemon before its first observer pass,
  // dead daemon lineage) the row rests at the same `○` a known-idle one does —
  // both readings send you into the tab to find out. See NO_STATE_GLYPH.
  const glyph = isAgent && carriesState ? rowView.stateGlyph : NO_STATE_GLYPH
  // depth 1, not 2: a tab row starts at the same column as its
  // worktree row — the circle status glyph carries the hierarchy, and the
  // extra indent cell wasted width the narrow rail doesn't have.
  return (
    <RowShell rowId={props.rowId} flatIndex={props.flatIndex} depth={1} shared={props.shared}>
      <text
        fg={carriesState ? toneColor(theme, rowView.tone) : theme.textMuted}
        wrapMode="none"
        width={2}
        flexShrink={0}
      >
        {`${glyph} `}
      </text>
      <box flexDirection="row" flexGrow={1} paddingRight={1} gap={1}>
        <text fg={theme.textMuted} wrapMode="none" flexBasis={0} flexGrow={1} flexShrink={1}>
          {truncateEndCells(
            props.tab.label,
            // The 2-cell state-glyph column is this row's extra fixed spend.
            treeLabelBudget(
              shared,
              2 + (shared.movingRowId === props.rowId ? clusterCells(t("tasks.moveChip").trim()) : 0),
            ),
            charWidth,
          )}
        </text>
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
