/** One task or header row of the rail: its marks, chips and fold count. The list and its menus are `rail-view.tsx`. */

import type { MouseEvent } from "react"
import type { RowStatus, TabRow, TaskRow } from "rove-bridge/protocol"
import { t } from "./i18n/index.ts"
import { CloudMark } from "./machines-view.tsx"
import { PrChip } from "./pr-chip.tsx"
import type { TreeGuide } from "./rail-blocks.ts"
import type { DragProps, RowPlace } from "./rail-drag.ts"
import { statusMark } from "./rail-glyphs.ts"
import type { NavRow } from "./rail.ts"
import { useRowTip } from "./row-tip.tsx"
import { RowTokens } from "./row-tokens.tsx"
import { StartsChip } from "./starts-chip.tsx"
import { useStatusMarkStyle } from "./status-mark.ts"
import { todoCount } from "./task-todos.ts"
import { tc } from "./tui-copy.ts"
import { Chevron } from "./ui/chevron.tsx"
import { EngineIcon, type EngineIconData } from "./ui/engine-icon.tsx"
import { GroupActions } from "./ui/project-actions.tsx"
import { CHILD_INDENT, FOLD_TOGGLE, RAIL_CURSOR, guideClass, projectHead } from "./ui/rail.ts"
import { CHIPS, ROW_TITLE_RAIL, ROW_TITLE_RUNNING, rowClass } from "./ui/row.ts"
import { StatusDots } from "./ui/status-dots.tsx"
import { type SwipeAction, SwipeRow } from "./ui/swipe-row.tsx"

export function RailRow(props: {
  row: Exclude<NavRow, { kind: "pane" | "round" }>
  /** A child task's indent columns, outermost first. */
  guides?: readonly TreeGuide[]
  /** The task's project, named on a top-level row of the by-state list, which has no project headers. */
  repo?: string
  /** A task on another machine: its cloud mark's text (`on mac · offline`); null for this machine's rows. */
  cloud: string | null
  /** A task row's tabs: the engine's own name for its conversation shows in place of the task title. */
  tabs?: readonly TabRow[]
  /** The task's engine's brand mark; absent = a neutral ring. */
  engineIcon?: EngineIconData | undefined
  selected: boolean
  cursor: boolean
  moving: boolean
  /** Its machine is unreachable: the last known state, greyed (TUI `task.origin.stale`). */
  stale: boolean
  /** Drag-to-reorder handlers, on a row that can move. */
  drag?: DragProps
  /** This row is being dragged; the rows around it already show where it lands. */
  dragging: boolean
  /** Its id for the drag's measure, and its shift while a drag previews the new order. */
  place: RowPlace
  /** A project header whose rows are folded away. */
  collapsed?: boolean
  /** A project header's +: a new task in that project. */
  onNewTask?: () => void
  onClick: (e?: MouseEvent) => void
  onMenu: (e: MouseEvent) => void
  /** A task row's task, then its descendants: their PRs roll up into its PR mark. */
  prTasks?: readonly TaskRow[]
  /** A folded task: the most urgent state of it and its hidden descendants, drawn in its one status mark. */
  rollup?: RowStatus | undefined
  onToggleFold: () => void
  /** A phone's swipe actions on a task row. */
  swipe?: { left: SwipeAction; right: SwipeAction }
}) {
  const { row } = props
  const tip = useRowTip(row.kind === "task" ? row.task.label : "", props.cursor && row.kind === "task")
  const cursor = props.cursor ? RAIL_CURSOR : ""
  if (row.kind === "project" || row.kind === "state") {
    return (
      <h2
        className={projectHead({ moving: props.moving, dragging: props.dragging, grab: props.drag !== undefined })}
        onContextMenu={props.onMenu}
        onKeyDown={(e) => {
          // Let the focused header button activate before the rail handles the current task's keys.
          if (e.key === "Enter" || e.key === " ") e.stopPropagation()
        }}
        {...props.place}
        {...props.drag}
      >
        <GroupActions
          label={row.label}
          repo={row.kind === "project" && !row.noProject ? row.repo : undefined}
          collapsed={!!props.collapsed}
          onToggle={props.onClick}
          onNewTask={props.onNewTask}
        />
      </h2>
    )
  }
  const task = row.task
  const running = task.rowStatus?.kind === "running"
  const count = todoCount(task)
  const markStyle = useStatusMarkStyle()
  const byEngine = markStyle === "engine"
  const status = row.fold?.collapsed ? props.rollup : task.rowStatus
  const button = (
    <button
      type="button"
      ref={tip.ref}
      className={`${rowClass({ selected: props.selected, moving: props.moving, lifted: props.dragging, grab: props.drag !== undefined })} ${cursor}`}
      onClick={props.onClick}
      onContextMenu={props.onMenu}
      onPointerEnter={tip.onPointerEnter}
      onPointerLeave={tip.onPointerLeave}
      {...props.place}
      {...props.drag}
    >
      {props.guides && (
        <span className={CHILD_INDENT} aria-hidden="true">
          {props.guides.map((guide, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a column's place is its identity
            <span key={i} className={guideClass(guide)} />
          ))}
        </span>
      )}
      {markStyle !== "dots" && (
        <EngineIcon
          icon={props.engineIcon}
          name={task.engine?.name}
          status={byEngine ? statusMark(status) : undefined}
        />
      )}
      <span className={`${ROW_TITLE_RAIL} ${props.stale ? "text-subtle" : ""} ${running ? ROW_TITLE_RUNNING : ""}`}>
        {row.attempt ?? task.label}
      </span>
      <span className={`${CHIPS} ml-auto items-center`}>
        <RowTokens tokens={task.rowTokens} />
        {props.repo && <span className="max-w-24 truncate text-subtle">{props.repo}</span>}
        {row.level !== undefined && <span className="text-subtle">{row.level}</span>}
        {(task.extraRepoCount ?? 0) > 0 && (
          <span
            className="text-subtle"
            title={t(task.extraRepoCount === 1 ? "rail.extraReposOne" : "rail.extraRepos", {
              count: task.extraRepoCount ?? 0,
            })}
          >
            +{task.extraRepoCount}
          </span>
        )}
        {count && (
          <span
            className="text-subtle tabular-nums"
            title={t(count.total === 1 ? "rail.todosOne" : "rail.todos", count)}
          >
            {count.done}/{count.total}
          </span>
        )}
        {row.fold?.collapsed && <FoldCount count={row.fold.count} onUnfold={props.onToggleFold} />}
        {task.kept && (
          <span className="text-accent" title={t("compare.kept")}>
            ✓
          </span>
        )}
        {task.pinned && <span className="text-subtle">▴</span>}
        {task.startsAt && <StartsChip at={task.startsAt} />}
        {/* The PR list opens where the title tip sits; only one card at a time. */}
        <PrChip tasks={props.prTasks ?? [task]} onOpen={tip.hide} />
        {/* The cloud of a task elsewhere sits before the row's state, so the state column lines up down the rail. */}
        {props.cloud && <CloudMark label={props.cloud} onOpen={tip.hide} />}
        {!byEngine && <StatusDots status={status} />}
      </span>
    </button>
  )
  return props.swipe ? (
    <SwipeRow left={props.swipe.left} right={props.swipe.right} ground="paper">
      {button}
    </SwipeRow>
  ) : (
    button
  )
}

/** `3 ›` on a folded task: how many descendants it hides; a click unfolds. An open parent shows nothing; the menu and the keyboard fold it. */
function FoldCount(props: { count: number; onUnfold: () => void }) {
  const label = tc("tasks", "menu.expandChildren")
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: a button cannot nest in the row's button; the row's menu entry is the keyboard path
    // biome-ignore lint/a11y/useSemanticElements: same reason: the row is itself a button
    <span
      role="button"
      tabIndex={-1}
      aria-label={label}
      aria-expanded={false}
      className={`chip text-muted ${FOLD_TOGGLE}`}
      title={label}
      onClick={(e) => {
        e.stopPropagation()
        props.onUnfold()
      }}
    >
      {props.count}
      {/* The project header's folded chevron, so a folded task reads the same way. */}
      <Chevron right />
    </span>
  )
}
