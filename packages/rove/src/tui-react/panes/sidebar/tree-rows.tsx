/** @jsxImportSource @opentui/react */
/**
 * Tree rows: project header flush, a task one cell in, each generation of
 * child tasks one cell deeper (the state glyph carries the hierarchy). A task
 * row is `[status] label` plus the right-edge cluster and stays ONE cell
 * tall: a dozen tasks must fit the rail.
 *
 * A task is one conversation, so its row carries that conversation's status:
 * the daemon's row status (`row-status-sync.ts`) drawn through `rowStatusGlyph`.
 * A folded task also names how many children it hides and the most urgent
 * state among them.
 */

import { type TaskEngineState, liveRowTokens } from "@/client/remote-orchestrator"
import type { Task } from "@/types/task"
import { TextAttributes } from "@opentui/core"
import type { RowStatus } from "@sma1lboy/rove-daemon/daemon/row-status"
import { useMemo } from "react"
import { charWidth, displayWidth } from "../../../lib/display-width"
import { relativeAge } from "../../../lib/relative-time"
import { rowStatusGlyph } from "../../../lib/row-status-glyph"
import { DEFAULT_RUNNING_TITLE, RUNNING_TITLE_KEY, normalizeRunningTitle } from "../../../state/running-title"
import { breathColor, breathGlyph } from "../../../tui/lib/breathe"
import { truncateEndCells } from "../../../tui/lib/truncate"
import { currentBranch, pollCurrentBranch } from "../../../tui/panes/sidebar/git-head"
import { remoteMarkLive, remoteRowCaption } from "../../../tui/panes/sidebar/machine-layer"
import { prChip } from "../../../tui/panes/sidebar/row-chips"
import {
  type SidebarRowView,
  buildSidebarRowView,
  sidebarTone,
  withSpinnerFrame,
} from "../../../tui/panes/sidebar/row-view"
import {
  type RemoteMark,
  type TreeFold,
  childMarkerOf,
  rowLiveBranchPath,
  tabRowActivity,
  worktreeRowLabel,
} from "../../../tui/panes/sidebar/tree-core"
import { rowTokenTone, toneColor, truncateBranchLabel } from "../../../tui/panes/sidebar/view-core"
import { useOptionalKV } from "../../context/kv"
import { useTheme } from "../../context/theme"
import { useT } from "../../i18n"
import { ShimmerLabel } from "../../lib/shimmer-label"
import { useGlyphs } from "../../lib/use-glyphs"
import { useTaskColor } from "../../lib/use-task-color"
import { useTabRowStatus, useTaskRowStatus } from "../../workspace/row-status-sync"
import { useMostUrgentStatus } from "./fold-summary"
import { completionStampOf, useClockTick, useDonePulse, usePollOnClock, useSpinnerFrame } from "./row-cards"
import { MoveChip, RowShell, type TreeRowShared, clusterCells, treeLabelBudget } from "./tree-row-shell"

/** Cells of the title a remote row's cursor caption must leave standing. */
const REMOTE_TITLE_CELLS = 12

/** Fixed terminal glyphs, the routines twisty's exception: a child's directory is shared (`⑂`) or its own (`⎇`). */
export const SHARED_MARK = "⑂"
export const WORKTREE_MARK = "⎇"
const FOLD_OPEN = "▾"
const FOLD_CLOSED = "▸"

/**
 * Age in the current state (`12m`) for WORKING or STOPPED rows only; null
 * otherwise, or every idle tab would wear a number. A row showing one
 * re-renders on the poll clock (`useClockTick`).
 */
function statusAgeLabel(status: RowStatus | undefined): string | null {
  if (!status || status.since <= 0) return null
  if (status.kind !== "running" && status.kind !== "attention" && status.kind !== "needs-input") return null
  // `relativeAge` clamps a clock skewed ahead of the daemon to `0s`.
  return relativeAge(status.since)
}

/**
 * The tab ledger entry for this task's conversation: a migrated child's
 * aliased tab, else the freshest entry of its own tabs (one engine tab; a
 * stale shell entry never outranks a newer one).
 */
function conversationActivity(
  task: Task,
  tabStates: ReadonlyMap<string, ReadonlyMap<string, TaskEngineState>> | undefined,
): TaskEngineState | undefined {
  const alias = task.ptyAlias
  const tabs = tabStates?.get(alias?.taskId ?? task.id)
  if (!tabs) return undefined
  if (alias) return tabRowActivity({ tabId: alias.tabId, tabActivities: tabs })
  let latest: TaskEngineState | undefined
  for (const activity of tabs.values()) if (!latest || activity.at > latest.at) latest = activity
  return latest
}

/**
 * A state cell's view, spinner frame, landing pulse and colour for one status.
 * The landing flash keys on the engine's completion stamp, so a turn that ends
 * while you watch still flashes and a re-render of a read one does not.
 */
function useStateCell(args: {
  readonly task: Task
  readonly status: RowStatus | undefined
  readonly lifecycle: { readonly subagents: number } | undefined
  readonly activity: TaskEngineState | undefined
}) {
  const { theme } = useTheme()
  const baseView = useTabRowBaseView({ task: args.task, status: args.status, lifecycle: args.lifecycle })
  const frame = useSpinnerFrame(baseView.loading)
  const rowView = withSpinnerFrame(baseView, () => frame)
  const pulsing = useDonePulse(completionStampOf(args.activity))
  const fg = pulsing
    ? theme.success
    : rowView.loading && rowView.tone === "primary"
      ? breathColor(theme.primary, theme.textMuted, frame)
      : toneColor(theme, rowView.tone)
  return { rowView, fg, pulsing, frame }
}

/**
 * The task's state cell: the daemon's status for its conversation. A migrated
 * child's conversation is still its parent's tab, so it reads that tab; a
 * task-level job or deletion (the rollup's `busy`) shows over either.
 */
function useTaskStateCell(task: Task, shared: TreeRowShared) {
  const alias = task.ptyAlias
  const rollup = useTaskRowStatus(task.id)
  const aliased = useTabRowStatus(alias?.taskId ?? task.id, alias?.tabId ?? "")
  const status = alias && rollup?.kind !== "busy" ? aliased : rollup
  const cell = useStateCell({
    task,
    status,
    lifecycle: shared.engineLifecycle?.get(task.id),
    activity: conversationActivity(task, shared.engineTabState),
  })
  return { status, ...cell }
}

/** `▸ 3 ●` on a folded task: the fold, how many descendants it hides, and the most urgent of them. */
function FoldCluster(props: { readonly task: Task; readonly fold: TreeFold; readonly shared: TreeRowShared }) {
  const { theme } = useTheme()
  const glyphs = useGlyphs()
  const { fold } = props
  const urgent = useMostUrgentStatus(fold.descendantIds, fold.collapsed)
  const mark = rowStatusGlyph(urgent, glyphs)
  const frame = useSpinnerFrame(fold.collapsed && mark.spinning)
  return (
    <box
      flexDirection="row"
      gap={1}
      flexShrink={0}
      onMouseUp={(evt: { stopPropagation(): void }) => {
        evt.stopPropagation()
        props.shared.onToggleFold?.(props.task.id)
      }}
    >
      <text fg={theme.textMuted} wrapMode="none">
        {fold.collapsed ? FOLD_CLOSED : FOLD_OPEN}
      </text>
      {fold.collapsed ? (
        <text fg={theme.textMuted} wrapMode="none">
          {String(fold.count)}
        </text>
      ) : null}
      {fold.collapsed && urgent ? (
        <text fg={toneColor(theme, sidebarTone(mark.tone))} wrapMode="none">
          {mark.spinning ? breathGlyph(glyphs.spinner, frame) : mark.glyph}
        </text>
      ) : null}
    </box>
  )
}

/**
 * A task row: `[state] label`, then its facts (pin, PR chip, ±stats, a
 * deletion or checkout in flight) and, on a child, the marker for where it
 * runs plus a level number once the indent stops growing.
 *
 * A task on ANOTHER machine (`remote`) wears a cloud at the row's right edge — muted
 * while that machine is online, warning-toned (and the title greyed) while it
 * is offline, connecting or mismatched. Under the cursor the cloud also says
 * where: `on <host> · <state>`. Machines are not sections; this mark is the
 * only place a row says it lives elsewhere.
 */
export function WorktreeTreeRow(props: {
  readonly rowId: string
  readonly flatIndex: number
  readonly task: Task
  /** Tree depth — 1 at rest. */
  readonly depth?: number
  /** The real generation of a row past the indent cap (`TreeRow.level`). */
  readonly level?: number
  /** Set on a task with children. */
  readonly fold?: TreeFold
  /** Set when the task lives on another machine (`applyMachineLayer`). */
  readonly remote?: RemoteMark
  readonly shared: TreeRowShared
}) {
  const { theme } = useTheme()
  const t = useT()
  const glyphs = useGlyphs()
  const kv = useOptionalKV()
  const shared = props.shared
  const task = props.task
  const chip = prChip(task, glyphs)
  // Named by BRANCH (`worktreeRowLabel`). Main checkouts and directory/scratch
  // tasks store none and move freely, so they poll their own HEAD.
  const livePath = rowLiveBranchPath(task)
  usePollOnClock(livePath, pollCurrentBranch)
  const label = worktreeRowLabel(task, livePath ? { liveBranch: currentBranch(livePath) } : {})
  const moving = shared.movingRowId === props.rowId
  const { status, rowView, fg, pulsing, frame } = useTaskStateCell(task, shared)
  const age = statusAgeLabel(status)
  useClockTick(age !== null)
  // The deletion WORD is a task fact; the glyph is the daemon's.
  const deletionPhase = task.deletion?.phase
  const deleting = deletionPhase === "queued" || deletionPhase === "running"
  const deleteFailed = deletionPhase === "error"
  // A slow checkout says how far it got, beside its spinner.
  const checkoutPercent =
    status?.kind === "busy" && status.reason === "job" ? shared.taskJobs?.get(task.id)?.progress : undefined
  const checkoutText = checkoutPercent === undefined ? null : `${checkoutPercent}%`
  // Rides beside the branch label, not in place of it: a failed deletion
  // leaves the branch, and rows all reading "delete failed" are unusable.
  const deletionWord =
    deleting || deleteFailed ? t(deleteFailed ? "tasks.subtitle.deleteFailed" : "tasks.subtitle.deleting") : null
  // Expired plugin tokens drop at RENDER time too, before the daemon's republish.
  useClockTick((shared.rowTokens?.get(task.id)?.length ?? 0) > 0)
  const tokens = liveRowTokens(shared.rowTokens, task.id, Date.now())
  const remote = props.remote
  const remoteLive = remote ? remoteMarkLive(remote) : true
  const caption = remote && shared.cursorIndex === props.flatIndex ? remoteRowCaption(remote, t) : null
  const marker = childMarkerOf(task)
  const fold = props.fold
  const reserved =
    // The state-glyph column, and the indent past the first level `treeLabelBudget` assumes.
    2 +
    ((props.depth ?? 1) - 1) +
    // A plugin can crowd the branch name but never overflow the row.
    tokens.reduce((cells, token) => cells + clusterCells(token.text), 0) +
    (deletionWord ? clusterCells(deletionWord) : 0) +
    (checkoutText ? clusterCells(checkoutText) : 0) +
    (age ? clusterCells(age) : 0) +
    (props.level !== undefined ? clusterCells(String(props.level)) : 0) +
    // Beside a fold glyph the marker sits flush against it (no gap), so the pair costs two cells.
    (marker ? (fold ? displayWidth(SHARED_MARK) : clusterCells(SHARED_MARK)) : 0) +
    (fold
      ? clusterCells(fold.collapsed ? FOLD_CLOSED : FOLD_OPEN) +
        (fold.collapsed ? clusterCells(String(fold.count)) + clusterCells(glyphs.idle) : 0)
      : 0) +
    (remote ? clusterCells(glyphs.remote) : 0) +
    (task.pinned === true ? 2 : 0) +
    (chip ? 2 : 0) +
    (moving ? clusterCells(t("tasks.moveChip").trim()) : 0)
  // The cursor's caption takes what the title leaves (the title keeps up to
  // REMOTE_TITLE_CELLS), clipped with `…`, so a narrow rail never loses the branch.
  const budget = treeLabelBudget(shared, reserved)
  const captionCells = caption ? Math.max(0, budget - Math.min(displayWidth(label), REMOTE_TITLE_CELLS) - 1) : 0
  const remoteText = remote
    ? captionCells > 2
      ? `${glyphs.remote} ${truncateEndCells(caption ?? "", captionCells, charWidth)}`
      : glyphs.remote
    : null
  const mark = useTaskColor(task.id)
  const shimmer =
    rowView.loading &&
    !pulsing &&
    normalizeRunningTitle(kv?.get(RUNNING_TITLE_KEY, DEFAULT_RUNNING_TITLE)) === "shimmer"
  const clipped = truncateEndCells(label, budget - (remoteText ? displayWidth(remoteText) - 1 : 0), charWidth)
  return (
    <RowShell rowId={props.rowId} flatIndex={props.flatIndex} depth={props.depth ?? 1} shared={shared} mark={mark}>
      <text fg={fg} attributes={pulsing ? TextAttributes.BOLD : undefined} wrapMode="none" width={2} flexShrink={0}>
        {`${rowView.stateGlyph} `}
      </text>
      <box flexDirection="row" flexGrow={1} paddingRight={1} gap={1}>
        {/* A row from an unreachable machine is the LAST KNOWN state, not a
            live one — it keeps its place and drops to muted rather than
            disappearing, which would erase the only record of where the work
            is. */}
        <text
          fg={task.origin?.stale || !remoteLive ? theme.textMuted : theme.text}
          attributes={pulsing ? TextAttributes.BOLD : undefined}
          wrapMode="none"
          flexBasis={0}
          flexGrow={1}
          flexShrink={1}
        >
          {shimmer ? (
            <ShimmerLabel label={clipped} tick={frame} muted={theme.textMuted} accent={theme.primary} />
          ) : (
            clipped
          )}
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
        {deletionWord ? (
          <text fg={deleteFailed ? theme.error : theme.textMuted} wrapMode="none" flexShrink={0}>
            {deletionWord}
          </text>
        ) : null}
        <MoveChip rowId={props.rowId} shared={shared} />
        {checkoutText ? (
          <text fg={theme.textMuted} wrapMode="none" flexShrink={0}>
            {checkoutText}
          </text>
        ) : null}
        {age ? (
          <text fg={theme.textMuted} attributes={TextAttributes.DIM} wrapMode="none" flexShrink={0}>
            {age}
          </text>
        ) : null}
        {props.level !== undefined ? (
          <text fg={theme.textMuted} wrapMode="none" flexShrink={0}>
            {String(props.level)}
          </text>
        ) : null}
        {marker || fold ? (
          <box flexDirection="row" flexShrink={0}>
            {marker ? (
              <text fg={marker === "shared" ? theme.info : theme.textMuted} wrapMode="none" flexShrink={0}>
                {marker === "shared" ? SHARED_MARK : WORKTREE_MARK}
              </text>
            ) : null}
            {fold ? <FoldCluster task={task} fold={fold} shared={shared} /> : null}
          </box>
        ) : null}
        {remoteText ? (
          <text fg={remoteLive ? theme.textMuted : theme.warning} wrapMode="none" flexShrink={0}>
            {remoteText}
          </text>
        ) : null}
      </box>
    </RowShell>
  )
}

/**
 * The row view of a conversation's status, memoized on the real inputs so the
 * ~10Hz spinner tick doesn't re-derive idle rows. Exported for its memo test.
 */
export function useTabRowBaseView(args: {
  readonly task: Task
  readonly status: RowStatus | undefined
  readonly lifecycle: { readonly subagents: number } | undefined
}): SidebarRowView {
  const t = useT()
  const glyphs = useGlyphs()
  const { task, status, lifecycle } = args
  return useMemo(() => {
    // Rebuild on language change: buildSidebarRowView reads the global `t`.
    void t
    return buildSidebarRowView({
      task,
      status,
      lifecycle,
      spinnerFrame: 0,
      subtitleBudget: 0,
      truncateBranch: truncateBranchLabel,
      glyphs,
    })
  }, [task, status, lifecycle, t, glyphs])
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
