/** @jsxImportSource @opentui/react */
/**
 * Tree rows: project header flush, worktrees one cell in, tab rows at the
 * SAME column as their worktree (the state glyph carries the hierarchy). A
 * worktree row is `[status] · label` plus the right-edge cluster and stays
 * ONE cell tall: a dozen worktrees must fit the rail.
 *
 * Every glyph is the daemon's row status (`row-status-sync.ts`) drawn through
 * `rowStatusGlyph`. Each tab row shows its own tab's; a worktree row shows the
 * no activity glyph: status lives on its tab rows. It spins only for a
 * task-level job or deletion (the rollup's `busy`).
 *
 * An AGENT tab row can opt in to a second cell naming the live engine
 * (`state/tab-row-height.ts`, off by default: it roughly halves how many rows
 * fit). Non-agent tabs stay one cell.
 */

import { type TaskEngineState, liveRowTokens } from "@/client/remote-orchestrator"
import type { Task } from "@/types/task"
import { TextAttributes } from "@opentui/core"
import type { RowStatus } from "@sma1lboy/rove-daemon/daemon/row-status"
import { useMemo } from "react"
import { engineDisplayName } from "../../../engine/interactive-command"
import { engineEntry } from "../../../engine/registry"
import { charWidth, displayWidth } from "../../../lib/display-width"
import { relativeAge } from "../../../lib/relative-time"
import { rowStatusGlyph } from "../../../lib/row-status-glyph"
import { DEFAULT_RUNNING_TITLE, RUNNING_TITLE_KEY, normalizeRunningTitle } from "../../../state/running-title"
import { TAB_ROW_HEIGHT_KEY, normalizeTabRowHeight } from "../../../state/tab-row-height"
import { breathColor, breathGlyph, mixInk } from "../../../tui/lib/breathe"
import { effortMark } from "../../../tui/lib/effort-glyph"
import { truncateEndCells } from "../../../tui/lib/truncate"
import { currentBranch, pollCurrentBranch } from "../../../tui/panes/sidebar/git-head"
import { remoteMarkLive, remoteRowCaption } from "../../../tui/panes/sidebar/machine-layer"
import { prChip } from "../../../tui/panes/sidebar/row-chips"
import { buildSidebarRowView, sidebarTone, withSpinnerFrame } from "../../../tui/panes/sidebar/row-view"
import {
  type RemoteMark,
  type TreeTab,
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
import { completionStampOf, useClockTick, useDonePulse, usePollOnClock, useSpinnerFrame } from "./row-cards"
import { MoveChip, RowShell, type TreeRowShared, clusterCells, treeLabelBudget } from "./tree-row-shell"

/** Cells of the title a remote row's cursor caption must leave standing. */
const REMOTE_TITLE_CELLS = 12

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
 * A worktree row whose tabs are listed under it carries NO engine glyph (each
 * tab row carries its own); only worktree-level facts: branch, pin, PR chip,
 * ±stats, and the rollup's `busy` (materializing, deleting).
 *
 * Both jobs must show HERE: a materializing task has no tab rows yet (a tab
 * is recorded only once delivery succeeds), and `TaskDeletionCoordinator`
 * sweeps PTYs before touching the worktree, so a failed deletion has no tab
 * to carry it.
 *
 * With no tab list under it (`tabsListed` false), the row stands for the
 * whole task and shows the daemon's rollup, as the folded rail does.
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
  /** Set when the task lives on another machine (`applyMachineLayer`). */
  readonly remote?: RemoteMark
  /** This task's tab rows follow this row. */
  readonly tabsListed?: boolean
  readonly shared: TreeRowShared
}) {
  const { theme } = useTheme()
  const t = useT()
  const glyphs = useGlyphs()
  const shared = props.shared
  const task = props.task
  const chip = prChip(task, glyphs)
  // Named by BRANCH (`worktreeRowLabel`). Main checkouts and directory/scratch
  // tasks store none and move freely, so they poll their own HEAD.
  const livePath = rowLiveBranchPath(task)
  usePollOnClock(livePath, pollCurrentBranch)
  const label = worktreeRowLabel(task, livePath ? { liveBranch: currentBranch(livePath) } : {})
  const moving = shared.movingRowId === props.rowId
  const rollup = useTaskRowStatus(task.id)
  // The deletion WORD is a task fact; the glyph is the daemon's.
  const deletionPhase = task.deletion?.phase
  const deleting = deletionPhase === "queued" || deletionPhase === "running"
  const deleteFailed = deletionPhase === "error"
  // Status lives on tab rows (the owner's rule); a task row only spins while its worktree is made or it is deleted.
  const showGlyph = rollup?.kind === "busy"
  const rollupMark = rowStatusGlyph(showGlyph ? rollup : undefined, glyphs)
  const spinning = showGlyph && rollupMark.spinning
  const frame = useSpinnerFrame(spinning)
  // A slow checkout says how far it got, beside its spinner.
  const checkoutPercent =
    rollup?.kind === "busy" && rollup.reason === "job" ? shared.taskJobs?.get(task.id)?.progress : undefined
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
  const reserved =
    // The glyph column exists only when the row shows a status.
    (showGlyph ? 2 : 0) +
    // A plugin can crowd the branch name but never overflow the row.
    tokens.reduce((cells, token) => cells + clusterCells(token.text), 0) +
    (deletionWord ? clusterCells(deletionWord) : 0) +
    (checkoutText ? clusterCells(checkoutText) : 0) +
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
  return (
    <RowShell rowId={props.rowId} flatIndex={props.flatIndex} depth={props.depth ?? 1} shared={shared} mark={mark}>
      <box flexDirection="row" flexGrow={1} paddingRight={1} gap={1}>
        {/* A row from an unreachable machine is the LAST KNOWN state, not a
            live one — it keeps its place and drops to muted rather than
            disappearing, which would erase the only record of where the work
            is. */}
        <text
          fg={task.origin?.stale || !remoteLive ? theme.textMuted : theme.text}
          wrapMode="none"
          flexBasis={0}
          flexGrow={1}
          flexShrink={1}
        >
          {truncateEndCells(label, budget - (remoteText ? displayWidth(remoteText) - 1 : 0), charWidth)}
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
        {/* The right edge, as Claude Desktop's list: a job or deletion spinner, then the cloud of a task elsewhere. */}
        {showGlyph ? (
          <text
            fg={
              spinning
                ? breathColor(theme.primary, theme.textMuted, frame)
                : toneColor(theme, sidebarTone(rollupMark.tone))
            }
            wrapMode="none"
            flexShrink={0}
          >
            {spinning ? breathGlyph(glyphs.spinner, frame) : rollupMark.glyph}
          </text>
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
 * The tab row's `buildSidebarRowView`, memoized on the real inputs so the
 * ~10Hz spinner tick doesn't re-derive idle rows. Exported for its memo test.
 */
export function useTabRowBaseView(args: {
  readonly task: Task
  readonly status: RowStatus | undefined
  readonly lifecycle: { readonly subagents: number } | undefined
}): ReturnType<typeof buildSidebarRowView> {
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

/**
 * A tab's state cell — glyph and colour — as the tree's tab row draws it: the
 * daemon's status for THIS tab (never the task rollup). The folded rail
 * colours its tab digit from the same hook, so fold and tree agree.
 */
export function useTabStateCell(args: {
  readonly task: Task
  readonly tab: TreeTab
  /** The daemon's per-tab engine activity for this task: only the landing pulse reads it. */
  readonly tabStates: ReadonlyMap<string, TaskEngineState> | undefined
  readonly lifecycle: { readonly subagents: number } | undefined
}) {
  const { theme } = useTheme()
  const { task, tab } = args
  const status = useTabRowStatus(task.id, tab.id)
  const baseView = useTabRowBaseView({ task, status, lifecycle: args.lifecycle })
  const frame = useSpinnerFrame(baseView.loading)
  const rowView = withSpinnerFrame(baseView, () => frame)
  // The landing flash keys on the engine's completion stamp, so a turn that
  // ends while you watch still flashes and a re-render of a read one does not.
  const activity = tabRowActivity({ tabId: tab.id, tabActivities: args.tabStates })
  const pulsing = useDonePulse(completionStampOf(activity))
  const fg = pulsing
    ? theme.success
    : rowView.loading && rowView.tone === "primary"
      ? breathColor(theme.primary, theme.textMuted, frame)
      : toneColor(theme, rowView.tone)
  return { status, rowView, glyph: rowView.stateGlyph, fg, pulsing, frame }
}

export function TabTreeRow(props: {
  readonly rowId: string
  readonly flatIndex: number
  readonly task: Task
  readonly tab: TreeTab
  /** Tree depth — 1 at rest. */
  readonly depth?: number
  readonly shared: TreeRowShared
}) {
  const { theme } = useTheme()
  const t = useT()
  const shared = props.shared
  const { status, rowView, glyph, fg, pulsing, frame } = useTabStateCell({
    task: props.task,
    tab: props.tab,
    tabStates: shared.engineTabState?.get(props.task.id),
    lifecycle: shared.engineLifecycle?.get(props.task.id),
  })
  const age = statusAgeLabel(status)
  useClockTick(age !== null)
  // Second line, agent tabs only: the engine RUNNING, probed from the pty's
  // process tree (`TreeTab.liveVendor`), not task config (usually unset).
  // No answer → no second line. No KV provider → default height.
  const kv = useOptionalKV()
  const twoCell = normalizeTabRowHeight(kv?.get(TAB_ROW_HEIGHT_KEY, 1)) === 2
  const liveVendor = props.tab.liveVendor ?? null
  const modelLine = props.tab.engine === true && twoCell && liveVendor ? engineDisplayName(liveVendor) : null
  const mark = useTaskColor(props.task.id)
  const label = truncateEndCells(
    props.tab.label,
    // + the 2-cell state-glyph column.
    treeLabelBudget(
      shared,
      2 +
        (age ? clusterCells(age) : 0) +
        (shared.movingRowId === props.rowId ? clusterCells(t("tasks.moveChip").trim()) : 0),
    ),
    charWidth,
  )
  const shimmer =
    rowView.loading &&
    !pulsing &&
    normalizeRunningTitle(kv?.get(RUNNING_TITLE_KEY, DEFAULT_RUNNING_TITLE)) === "shimmer"
  // The task's pinned level rides along only when the live engine declares
  // it (the launch path drops any other), and only if the whole line fits.
  const level = props.task.modelEffort?.trim() ?? ""
  const effort = modelLine && liveVendor ? effortMark(engineEntry(liveVendor).effortLevels, level) : null
  const captionBudget = treeLabelBudget(shared, 2)
  const showEffort = effort !== null && displayWidth(`${modelLine} · ${effort.glyph} ${level}`) <= captionBudget
  return (
    <RowShell
      rowId={props.rowId}
      flatIndex={props.flatIndex}
      depth={props.depth ?? 1}
      shared={props.shared}
      mark={mark}
    >
      <text fg={fg} attributes={pulsing ? TextAttributes.BOLD : undefined} wrapMode="none" width={2} flexShrink={0}>
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
            {shimmer ? (
              <ShimmerLabel label={label} tick={frame} muted={theme.textMuted} accent={theme.primary} />
            ) : (
              label
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
          // DIM on spans, not the text: span attributes OR into the parent's,
          // and the level glyph brightens toward the accent undimmed.
          <text fg={theme.textMuted} wrapMode="none" paddingRight={1}>
            <span attributes={TextAttributes.DIM}>
              {truncateEndCells(modelLine, captionBudget, charWidth)}
              {showEffort ? " · " : ""}
            </span>
            {showEffort ? (
              <span fg={mixInk(theme.primary, theme.textMuted, effort.fraction)}>{effort.glyph}</span>
            ) : null}
            {showEffort ? <span attributes={TextAttributes.DIM}>{` ${level}`}</span> : null}
          </text>
        ) : null}
      </box>
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
