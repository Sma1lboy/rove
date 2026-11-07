/** The Tasks rail: wordmark + inbox count, then project → task → child task rows (TUI `tree-panel`). */

import { en as tasksEn, zh as tasksZh } from "@sma1lboy/rove/src/tui/i18n/messages/tasks.ts"
import type { MouseEvent } from "react"
import { useEffect, useRef } from "react"
import type { RowStatus, TabRow, TaskRow, TasksPayload } from "rove-bridge/protocol"
import { markHintUsed } from "./hint-state.ts"
import { t, useLocale } from "./i18n/index.ts"
import { InboxDialog } from "./inbox-view.tsx"
import { enterWorkspace } from "./layout.ts"
import { CloudMark, rowCloud, useMachines } from "./machines-view.tsx"
import type { AppModel } from "./model.ts"
import { moveMode, reorderingMain } from "./move-mode.ts"
import { startNewTask, startNewUngrouped } from "./new-session-view.tsx"
import { PageNav } from "./pages-host.tsx"
import { PrChip } from "./pr-chip.tsx"
import { ShortcutBadge } from "./prefix-guide.tsx"
import { withArchived } from "./rail-archived.ts"
import { type TreeGuide, treeGuides } from "./rail-blocks.ts"
import { PaneKeyHint, RailGrip, RecentRow } from "./rail-chrome.tsx"
import { type DragProps, type RowPlace, useRowDrag } from "./rail-drag.ts"
import { RailFoot } from "./rail-foot.tsx"
import { mostUrgentStatus } from "./rail-glyphs.ts"
import { railGroup } from "./rail-group.ts"
import { dropIdleMains } from "./rail-idle.ts"
import { openTaskRow, useRailFilters, useRailKeys } from "./rail-keys.ts"
import { repoLabel } from "./rail-labels.ts"
import { peekRail, railFolded, railPeek } from "./rail-layout.ts"
import { PaneRowView, openPane } from "./rail-pane-row.tsx"
import { withPanes } from "./rail-panes.ts"
import { RoundRowView } from "./rail-round-row.tsx"
import { SearchChip } from "./rail-search.tsx"
import { railStateRows, rowRepo, withStateCounts } from "./rail-states.ts"
import { type NavRow, type RowFold, foldProjects, railRows } from "./rail.ts"
import { type ProjectInfo, projectMenu, taskMenu, ungroupedMenu } from "./row-actions.tsx"
import { useRowTip } from "./row-tip.tsx"
import { SettingsDialog } from "./settings-view.tsx"
import { paneEdits, taskSplitItems } from "./split-actions.tsx"
import { StartsChip } from "./starts-chip.tsx"
import { useStore } from "./store.ts"
import { todoCount } from "./task-todos.ts"
import { tc } from "./tui-copy.ts"
import { type MenuItem, dialog, menu } from "./ui.ts"
import { Chevron } from "./ui/chevron.tsx"
import { Legend } from "./ui/legend.tsx"
import { INBOX_CHIP } from "./ui/overlay.ts"
import {
  CHILD_INDENT,
  FOLD_TOGGLE,
  PROJECT_ADD,
  PROJECT_TOGGLE,
  RAIL,
  RAIL_CURSOR,
  RAIL_EMPTY,
  RAIL_HEAD,
  RAIL_SEARCH,
  guideClass,
  projectChevron,
  projectHead,
  railBody,
} from "./ui/rail.ts"
import { CHIPS, ROW_TITLE_RAIL, ROW_TITLE_RUNNING, rowClass } from "./ui/row.ts"
import { BRACKET, HEAD_CHIP, WORDMARK } from "./ui/shell.ts"
import { StatusDots } from "./ui/status-dots.tsx"
import { UpdateChip } from "./update-view.tsx"
import { WelcomePane } from "./welcome-view.tsx"

/** Right click opens the row's menu where the pointer is (TUI tree menu). */
export function openMenu(e: MouseEvent, items: readonly MenuItem[]): void {
  e.preventDefault()
  // A keyboard contextmenu (Shift+F10) reports button 0; a right click reports 2.
  menu.set({ x: e.clientX, y: e.clientY, items, target: e.currentTarget as Element, fromKeyboard: e.button !== 2 })
}

export function RailView({ model, narrow }: { model: AppModel; narrow: boolean }) {
  const locale = useLocale()
  const payload: TasksPayload | null = useStore(model.tasks)
  const remoteTasks = useStore(model.remote)
  const machines = useMachines(model)
  const tabs = useStore(model.tabs)
  const tabsSettled = useStore(model.tabsSettled)
  const selection = useStore(model.selection)
  const tasks = payload?.tasks ?? []
  const unread = payload?.attention.filter((row) => row.unread).length ?? 0
  const selectedId = selection.taskId
  const byId = new Map([...tasks, ...remoteTasks].map((task) => [task.id, task]))

  const filters = useRailFilters()
  const moving = useStore(moveMode)
  const byState = useStore(railGroup) === "state"
  const reordering = useStore(reorderingMain)
  const build = (query: string) =>
    (byState ? railStateRows : railRows)({
      tasks,
      remote: remoteTasks,
      machines,
      sort: filters.sort,
      query,
      fold: { ...filters.hand, selectedId: selectedId ?? undefined },
    })
  const built = build(filters.search.active ? filters.search.query : "")
  const { groups } = built
  // A collapsed project keeps its header and hides what is under it; search shows everything.
  // Archived tasks are only in the closing fold, which a search leaves out (as the TUI).
  const rows = filters.search.active
    ? built.rows
    : withArchived(
        foldProjects(
          withPanes(withStateCounts(dropIdleMains(built.rows, tabs, selection.taskId, tabsSettled, reordering)), tabs),
          filters.collapsed,
        ),
        payload?.archived ?? [],
        filters.archivedOpen,
        { ...filters.hand, selectedId: selectedId ?? undefined },
      )
  const stops = (all: readonly NavRow[]) =>
    all.filter((row) => row.kind !== "project" && row.kind !== "state" && row.kind !== "round")
  const words = (locale === "zh" ? tasksZh : tasksEn).machine
  const offline = new Set(machines.filter((m) => m.state !== "online").map((m) => m.alias))
  const firstMovable = groups.find((group) => group.tasks.some((task) => task.kind === "main"))?.repo
  const projectInfo = (repo: string): ProjectInfo => ({
    mainTaskId: groups.find((group) => group.repo === repo)?.tasks.find((task) => task.kind === "main")?.id ?? null,
    label: repoLabel(repo),
    first: repo === firstMovable,
  })
  const drag = useRowDrag(model, tasks, !filters.search.active && !byState, filters.sort === "default", projectInfo)
  const place = drag.places(rows)
  const openSettings = () => dialog.set(<SettingsDialog model={model} />)
  const keys = useRailKeys(model, rows, filters, { selectedId, onNewTask: startNewTask, onSettings: openSettings })
  // Header Reorder lists the main it moves; the cursor goes to it so j/k drag its project.
  const reorderShown = reordering !== null && rows.some((row) => row.id === reordering)
  const setCursor = keys.setCursor
  useEffect(() => {
    if (reorderShown && reordering !== null) setCursor(reordering)
  }, [reorderShown, reordering, setCursor])
  const total = stops(build("").rows).length
  const rail = useRef<HTMLElement>(null)
  // Folded, the rail stays mounted and slides off to the left; inert so nothing in it takes focus or clicks,
  // until a hover at the page's left edge floats it back over the workspace.
  const folded = useStore(railFolded) && !narrow
  const peek = useStore(railPeek) && folded
  const recent = narrow ? (tasks.find((task) => task.id === selection.taskId && !task.deleting) ?? null) : null

  return (
    <nav
      className={`${RAIL} ${folded ? "is-folded" : ""}`}
      ref={rail}
      inert={folded && !peek}
      aria-hidden={folded && !peek}
      onMouseEnter={folded ? () => peekRail(true) : undefined}
      onMouseLeave={folded ? () => peekRail(false) : undefined}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the rail takes the TUI sidebar's keys while focused
      tabIndex={0}
      onKeyDown={(e) => {
        markHintUsed("sidebar")
        keys.onKeyDown(e)
      }}
    >
      <header className={RAIL_HEAD}>
        <span className={`${WORDMARK} mr-auto`}>
          <span className={BRACKET}>[</span> rove <span className={BRACKET}>]</span>
        </span>
        <span className="relative">
          <button
            type="button"
            className={`m-0 text-meta font-medium normal-nums inbox-chip relative ${INBOX_CHIP} ${HEAD_CHIP} ${unread > 0 ? "text-accent" : "text-muted"}`}
            onClick={() => dialog.set(<InboxDialog model={model} />)}
          >
            {t("rail.inbox", { count: unread })}
          </button>
          <ShortcutBadge model={model} bindingId="inbox.show" head />
        </span>
        <UpdateChip />
      </header>
      {moving && (
        <div className={`${RAIL_SEARCH} mono`}>
          <span className="text-accent">{tc("tasks", "moveChip").trim()}</span>
          <span className="keys-only ml-1.5 text-muted">
            <Legend text={t("taskops.moveHint")} />
          </span>
        </div>
      )}
      {filters.search.active && (
        <SearchChip
          query={filters.search.query}
          count={`${stops(rows).length}/${total}`}
          onChange={(query) => filters.setSearch((s) => ({ ...s, query }))}
        />
      )}
      <PageNav model={model} />
      <div data-rail-body className={railBody(drag.dragging !== null)} {...drag.body}>
        {payload && tasks.length === 0 && remoteTasks.length === 0 && narrow && <WelcomePane model={model} />}
        {payload && tasks.length === 0 && remoteTasks.length === 0 && !narrow && (
          <p className={RAIL_EMPTY}>{t("rail.empty")}</p>
        )}
        {recent && <RecentRow title={recent.title} />}
        {rows.map((row, i) =>
          row.kind === "round" ? (
            <RoundRowView
              key={row.id}
              row={row}
              guides={row.depth > 1 ? treeGuides(rows, i) : undefined}
              repo={byState && row.depth === 1 ? rowRepo(row.tasks[0]) : undefined}
              cursor={row.id === keys.cursor}
              place={place(row)}
              onClick={() => keys.setCursor(row.id)}
            />
          ) : row.kind === "pane" ? (
            <PaneRowView
              key={row.id}
              model={model}
              row={row}
              guides={treeGuides(rows, i)}
              cursor={row.id === keys.cursor}
              place={place(row)}
              onClick={() => {
                keys.setCursor(row.id)
                openPane(model, row)
                enterWorkspace()
              }}
              onMenu={(e) => {
                keys.setCursor(row.id)
                openMenu(e, paneEdits(model, row.task.id, row.tab, row.leaf))
              }}
            />
          ) : (
            <RailRow
              key={row.id}
              row={row}
              guides={row.kind === "task" && row.depth > 1 ? treeGuides(rows, i) : undefined}
              cloud={rowCloud(row, machines, words)}
              repo={byState && row.kind === "task" && row.depth === 1 ? rowRepo(row.task) : undefined}
              tabs={row.kind === "task" ? tabs[row.task.id] : undefined}
              selected={row.id === selectedId}
              cursor={row.id === keys.cursor}
              stale={row.machine !== undefined && offline.has(row.machine)}
              collapsed={(row.kind === "project" || row.kind === "state") && filters.collapsed.has(row.id)}
              drag={drag.props(row)}
              dragging={drag.dragging === row.id}
              place={place(row)}
              onNewTask={
                row.kind === "project"
                  ? row.noProject
                    ? startNewUngrouped
                    : () => startNewTask(row.repo, row.machine)
                  : undefined
              }
              moving={
                moving &&
                row.machine === undefined &&
                (row.kind === "project"
                  ? !row.noProject && projectInfo(row.repo).mainTaskId === keys.cursor
                  : row.id === keys.cursor && !(row.kind === "task" && row.task.kind === "main"))
              }
              prTasks={
                row.kind === "task"
                  ? [row.task, ...(row.fold?.descendantIds ?? []).flatMap((id) => byId.get(id) ?? [])]
                  : undefined
              }
              rollup={
                row.kind === "task" && row.fold?.collapsed
                  ? mostUrgentStatus([row.task, ...row.fold.descendantIds.flatMap((id) => byId.get(id) ?? [])])
                  : undefined
              }
              onToggleFold={() => {
                if (row.kind === "task") filters.toggleTaskFold(row.id, row.fold?.collapsed === true)
                if (row.kind === "archived") filters.toggleArchived()
              }}
              onClick={() => {
                keys.setCursor(row.id)
                if (row.kind === "archived") filters.toggleArchived()
                if (row.kind === "project" || row.kind === "state") filters.toggleProject(row.id)
                if (row.kind === "task") openTaskRow(model, row.task.id)
              }}
              onMenu={(e) => {
                // Another machine's project has no checkout here, so its header has no menu; its
                // tasks do (their verbs run on that machine, `taskMenu` drops the local-only ones).
                if (row.kind === "project" && row.machine !== undefined) return
                // Ungrouped is no repo and has no main row to stand in for it: it offers only its two starts.
                if (row.kind === "project" && row.noProject) {
                  openMenu(e, ungroupedMenu(model))
                  return
                }
                // The menu's target is the cursor, as the TUI's (a project header stands in with its main row).
                if (row.kind === "project") {
                  const info = projectInfo(row.repo)
                  if (info.mainTaskId && rows.some((r) => r.id === info.mainTaskId)) keys.setCursor(info.mainTaskId)
                  openMenu(e, projectMenu(model, row.repo, info))
                  return
                }
                // The Archived row names no task, so it has no menu (TUI `use-tree-menu`).
                if (row.kind !== "task") return
                keys.setCursor(row.id)
                openMenu(
                  e,
                  withSplitEntries(
                    withFoldEntry(taskMenu(model, row.task, null), row.fold, () =>
                      filters.toggleTaskFold(row.id, row.fold?.collapsed === true),
                    ),
                    taskSplitItems(model, row.task.id),
                  ),
                )
              }}
            />
          ),
        )}
      </div>
      <RailFoot model={model} narrow={narrow} onSettings={openSettings} />
      <PaneKeyHint pane="sidebar" />
      {!narrow && !folded && <RailGrip rail={rail} />}
    </nav>
  )
}

function RailRow(props: {
  row: Exclude<NavRow, { kind: "pane" | "round" }>
  /** A child task's indent columns, outermost first. */
  guides?: readonly TreeGuide[]
  /** The task's project, named on a top-level row of the by-state list, which has no project headers. */
  repo?: string
  /** A task on another machine: its cloud mark's text (`on mac · offline`); null for this machine's rows. */
  cloud: string | null
  /** A task row's tabs: the engine's own name for its conversation shows in place of the task title. */
  tabs?: readonly TabRow[]
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
  onClick: () => void
  onMenu: (e: MouseEvent) => void
  /** A task row's task, then its descendants: their PRs roll up into its PR mark. */
  prTasks?: readonly TaskRow[]
  /** A folded task: the most urgent state of it and its hidden descendants, drawn in its one status mark. */
  rollup?: RowStatus | undefined
  onToggleFold: () => void
}) {
  const { row } = props
  const tip = useRowTip(row.kind === "task" ? row.task.label : "", props.cursor && row.kind === "task")
  const cursor = props.cursor ? RAIL_CURSOR : ""
  if (row.kind === "project" || row.kind === "state") {
    return (
      <h2
        className={projectHead({ moving: props.moving, dragging: props.dragging })}
        onContextMenu={props.onMenu}
        {...props.place}
        {...props.drag}
      >
        <button
          type="button"
          className={PROJECT_TOGGLE}
          title={row.kind === "project" && !row.noProject ? row.repo : undefined}
          aria-expanded={!props.collapsed}
          onClick={props.onClick}
        >
          <span className="truncate">{row.label}</span>
          {row.kind === "state" && <span className="font-normal text-subtle">{row.count}</span>}
          <Chevron right={props.collapsed} className={projectChevron(!!props.collapsed)} />
        </button>
        {props.onNewTask && row.kind === "project" && (
          <button type="button" className={PROJECT_ADD} title={t("rail.newTask")} onClick={props.onNewTask}>
            +
          </button>
        )}
      </h2>
    )
  }
  if (row.kind === "archived") {
    return (
      <button
        type="button"
        className={`${rowClass({ moving: props.moving || props.dragging })} ${cursor}`}
        aria-expanded={row.expanded}
        onClick={props.onClick}
        {...props.place}
      >
        <span className={`${ROW_TITLE_RAIL} ${props.stale ? "text-subtle" : "text-muted"}`}>
          {tc("tasks", "archivedRow", { count: row.count })}
        </span>
      </button>
    )
  }

  const task = row.task
  const running = task.rowStatus?.kind === "running"
  const count = todoCount(task)
  return (
    <button
      type="button"
      ref={tip.ref}
      className={`${rowClass({ selected: props.selected, moving: props.moving || props.dragging })} ${cursor}`}
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
      <span className={`${ROW_TITLE_RAIL} ${props.stale ? "text-subtle" : ""} ${running ? ROW_TITLE_RUNNING : ""}`}>
        {row.attempt ?? task.label}
      </span>
      <span className={`${CHIPS} ml-auto items-center`}>
        {props.repo && <span className="max-w-24 truncate text-subtle">{props.repo}</span>}
        {row.level !== undefined && <span className="text-subtle">{row.level}</span>}
        {(task.extraRepoCount ?? 0) > 0 && (
          <span className="text-subtle" title={t("rail.extraRepos", { count: task.extraRepoCount ?? 0 })}>
            +{task.extraRepoCount}
          </span>
        )}
        {count && (
          <span className="text-subtle tabular-nums" title={t("rail.todos", count)}>
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
        {/* The right edge, as Claude Desktop's list: the row's state, then the cloud of a task elsewhere. */}
        <StatusDots status={row.fold?.collapsed ? props.rollup : task.rowStatus} />
        {props.cloud && <CloudMark label={props.cloud} />}
      </span>
    </button>
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

/** The fold entry sits with what opens the task, ahead of the edit and danger sections. */
function withFoldEntry(items: MenuItem[], fold: RowFold | undefined, toggle: () => void): MenuItem[] {
  if (!fold) return items
  const entry: MenuItem = {
    label: tc("tasks", fold.collapsed ? "menu.expandChildren" : "menu.collapseChildren"),
    section: "open",
    run: toggle,
  }
  const at = items.map((item) => item.section).lastIndexOf("open")
  return [...items.slice(0, at + 1), entry, ...items.slice(at + 1)]
}

/** Split right / down on the task's tab sit right after what opens the task: the tab strip is hidden by default, so this is the mouse route. */
function withSplitEntries(items: MenuItem[], entries: readonly MenuItem[]): MenuItem[] {
  const at = items.map((item) => item.section).lastIndexOf("open")
  return [...items.slice(0, at + 1), ...entries, ...items.slice(at + 1)]
}
