/** The Tasks rail: wordmark + inbox count, then project → task → child task rows (TUI `tree-panel`). */

import { en as tasksEn, zh as tasksZh } from "@sma1lboy/rove/src/tui/i18n/messages/tasks.ts"
import type { MouseEvent } from "react"
import { useRef } from "react"
import type { RowStatus, TabRow, TaskRow, TasksPayload } from "rove-bridge/protocol"
import { markHintUsed } from "./hint-state.ts"
import { t, useLocale } from "./i18n/index.ts"
import { InboxDialog } from "./inbox-view.tsx"
import { enterWorkspace, peekRail, railFolded, railPeek } from "./layout.ts"
import { CloudMark, rowCloud, useMachines } from "./machines-view.tsx"
import type { AppModel } from "./model.ts"
import { moveMode } from "./move-mode.ts"
import { startNewTask } from "./new-session-view.tsx"
import { PageNav } from "./pages-host.tsx"
import { PrChip } from "./pr-chip.tsx"
import { ShortcutBadge } from "./prefix-guide.tsx"
import { withArchived } from "./rail-archived.ts"
import { type TreeGuide, treeGuides } from "./rail-blocks.ts"
import { PaneKeyHint, RailGrip, RecentRow } from "./rail-chrome.tsx"
import { type DragProps, type RowPlace, useRowDrag } from "./rail-drag.ts"
import { mostUrgentStatus, needsPerson } from "./rail-glyphs.ts"
import { dropIdleProjects } from "./rail-idle.ts"
import { useRailFilters, useRailKeys } from "./rail-keys.ts"
import { type NavRow, type RowFold, railRows, repoLabel, rowTitle } from "./rail.ts"
import { type ProjectInfo, projectMenu, taskMenu } from "./row-actions.tsx"
import { useRowTip } from "./row-tip.tsx"
import { SettingsDialog } from "./settings-view.tsx"
import { StatusDots } from "./status-dots.tsx"
import { useStore } from "./store.ts"
import { tc } from "./tui-copy.ts"
import { type MenuItem, dialog, menu } from "./ui.ts"
import "./taskops.css"
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
  const build = (query: string) =>
    railRows({
      tasks,
      remote: remoteTasks,
      machines,
      sort: filters.sort,
      query,
      routines: filters.routines,
      fold: { ...filters.hand, selectedId: selectedId ?? undefined },
    })
  const built = build(filters.search.active ? filters.search.query : "")
  const { groups } = built
  // A collapsed project keeps its header and hides what is under it; search shows everything.
  // Archived tasks are only in the closing fold, which a search leaves out (as the TUI).
  const rows = filters.search.active
    ? built.rows
    : withArchived(
        foldProjects(dropIdleProjects(built.rows, tabs, selection.taskId, tabsSettled), filters.collapsed),
        payload?.archived ?? [],
        filters.archivedOpen,
        { ...filters.hand, selectedId: selectedId ?? undefined },
      )
  const stops = (all: readonly NavRow[]) => all.filter((row) => row.kind !== "project")
  const words = (locale === "zh" ? tasksZh : tasksEn).machine
  const offline = new Set(machines.filter((m) => m.state !== "online").map((m) => m.alias))
  const firstMovable = groups.find((group) => group.tasks.some((task) => task.kind === "main"))?.repo
  const projectInfo = (repo: string): ProjectInfo => ({
    mainTaskId: groups.find((group) => group.repo === repo)?.tasks.find((task) => task.kind === "main")?.id ?? null,
    label: repoLabel(repo),
    first: repo === firstMovable,
  })
  const drag = useRowDrag(model, tasks, !filters.search.active, filters.sort === "default", projectInfo)
  const place = drag.places(rows)
  const keys = useRailKeys(model, rows, filters, {
    selectedId,
    onNewTask: (repo, machine) => startNewTask(model, repo, machine),
    onSettings: () => dialog.set(<SettingsDialog model={model} />),
  })
  const total = stops(build("").rows).length
  const rail = useRef<HTMLElement>(null)
  // Folded, the rail stays mounted and slides off to the left; inert so nothing in it takes focus or clicks,
  // until a hover at the page's left edge floats it back over the workspace.
  const folded = useStore(railFolded) && !narrow
  const peek = useStore(railPeek) && folded
  const recent = narrow ? (tasks.find((task) => task.id === selection.taskId && !task.deleting) ?? null) : null

  return (
    <nav
      className={`rail ${folded ? "is-folded" : ""}`}
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
      <header className="rail-head">
        <span className="wordmark">
          <span className="bracket">[</span> rove <span className="bracket">]</span>
        </span>
        <span className="badge-host">
          <button
            type="button"
            className={`kicker inbox-chip ${unread > 0 ? "is-accent" : ""}`}
            onClick={() => dialog.set(<InboxDialog model={model} />)}
          >
            {t("rail.inbox", { count: unread })}
          </button>
          <ShortcutBadge model={model} bindingId="inbox.show" />
        </span>
        <UpdateChip />
      </header>
      {moving && (
        <div className="rail-search mono">
          <span className="tone-accent">{tc("tasks", "moveChip").trim()}</span>
          <span className="muted keys-only">{t("taskops.moveHint")}</span>
        </div>
      )}
      {filters.search.active && (
        <div className="rail-search mono">
          <span className="tone-accent">/</span>
          <span>{filters.search.query}</span>
          <span className="caret">█</span>
          <span className="muted">
            {filters.search.query ? `${stops(rows).length}/${total}` : t("rail.searchPlaceholder")}
          </span>
        </div>
      )}
      <PageNav model={model} />
      <div className={`rail-body ${drag.dragging ? "is-sorting" : ""}`} {...drag.body}>
        {payload && tasks.length === 0 && remoteTasks.length === 0 && narrow && <WelcomePane model={model} />}
        {payload && tasks.length === 0 && remoteTasks.length === 0 && !narrow && (
          <div className="empty">
            <p>{t("rail.empty")}</p>
            <p className="muted">{t("rail.emptyHint")}</p>
          </div>
        )}
        {recent && <RecentRow title={recent.title} />}
        {rows.map((row, i) => (
          <RailRow
            key={row.id}
            row={row}
            guides={row.kind === "task" && row.depth > 1 ? treeGuides(rows, i) : undefined}
            cloud={rowCloud(row, machines, words)}
            tabs={row.kind === "task" ? tabs[row.task.id] : undefined}
            selected={row.id === selectedId}
            cursor={row.id === keys.cursor}
            stale={row.machine !== undefined && offline.has(row.machine)}
            collapsed={row.kind === "project" && filters.collapsed.has(row.id)}
            drag={drag.props(row)}
            dragging={drag.dragging === row.id}
            place={place(row)}
            onNewTask={
              row.kind === "project" && !row.noProject ? () => startNewTask(model, row.repo, row.machine) : undefined
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
            foldUrgent={
              row.kind === "task" && row.fold?.collapsed
                ? mostUrgentStatus(row.fold.descendantIds.flatMap((id) => byId.get(id) ?? []))
                : undefined
            }
            onToggleFold={() => {
              if (row.kind === "task") filters.toggleTaskFold(row.id, row.fold?.collapsed === true)
              if (row.kind === "routines") filters.toggleRoutines(row.key)
              if (row.kind === "archived") filters.toggleArchived()
            }}
            onClick={() => {
              keys.setCursor(row.id)
              if (row.kind === "routines") filters.toggleRoutines(row.key)
              if (row.kind === "archived") filters.toggleArchived()
              if (row.kind === "project") filters.toggleProject(row.id)
              if (row.kind === "task") model.select(row.task.id)
              if (row.kind === "routines" || row.kind === "task") enterWorkspace()
            }}
            onMenu={(e) => {
              // Another machine's project has no checkout here, so its header has no menu; its
              // tasks do (their verbs run on that machine, `taskMenu` drops the local-only ones).
              if (row.kind === "project" && (row.machine !== undefined || row.noProject)) return
              // The menu's target is the cursor, as the TUI's (a project header stands in with its main row).
              if (row.kind === "project") {
                const info = projectInfo(row.repo)
                if (info.mainTaskId) keys.setCursor(info.mainTaskId)
                openMenu(e, projectMenu(model, row.repo, info))
                return
              }
              // The routines and Archived rows name no task, so they have no menu (TUI `use-tree-menu`).
              if (row.kind !== "task") return
              keys.setCursor(row.id)
              openMenu(
                e,
                withFoldEntry(taskMenu(model, row.task, null), row.fold, () =>
                  filters.toggleTaskFold(row.id, row.fold?.collapsed === true),
                ),
              )
            }}
          />
        ))}
      </div>
      <PaneKeyHint pane="sidebar" />
      {!narrow && !folded && <RailGrip rail={rail} />}
    </nav>
  )
}

function RailRow(props: {
  row: NavRow
  /** A child task's indent columns, outermost first. */
  guides?: readonly TreeGuide[]
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
  /** A folded task's most urgent hidden child. */
  foldUrgent?: RowStatus
  onToggleFold: () => void
}) {
  const { row } = props
  const tip = useRowTip(row.kind === "task" ? rowTitle(row.task, props.tabs) : "", props.cursor && row.kind === "task")
  const drop = props.dragging ? "is-dragging" : ""
  const cursor = `${props.cursor ? "is-cursor" : ""} ${props.moving ? "is-moving" : ""} ${props.stale ? "is-stale" : ""} ${drop}`
  if (row.kind === "project") {
    return (
      <h2
        className={`project-head ${props.moving ? "is-moving" : ""} ${props.stale ? "is-stale" : ""} ${drop}`}
        onContextMenu={props.onMenu}
        {...props.place}
        {...props.drag}
      >
        <button
          type="button"
          className="project-toggle"
          title={row.noProject ? undefined : row.repo}
          aria-expanded={!props.collapsed}
          onClick={props.onClick}
        >
          <span className="project-label">{row.label}</span>
          <svg
            className={`project-chevron ${props.collapsed ? "is-collapsed" : ""}`}
            viewBox="0 0 10 10"
            aria-hidden="true"
          >
            <path
              d="M2.5 3.75 5 6.25l2.5-2.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        {props.onNewTask && (
          <button type="button" className="project-add" title={t("rail.newTask")} onClick={props.onNewTask}>
            +
          </button>
        )}
      </h2>
    )
  }
  if (row.kind === "routines" || row.kind === "archived") {
    const routines = row.kind === "routines"
    const waiting = routines && !row.expanded ? row.tasks.filter(needsPerson).length : 0
    const words = routines
      ? row.tasks.length === 1
        ? tc("tasks", "routinesRowOne")
        : tc("tasks", "routinesRow", { count: row.tasks.length })
      : tc("tasks", "archivedRow", { count: row.count })
    return (
      <button
        type="button"
        className={`row count-row ${routines ? `routines-row ${props.selected ? "is-selected" : ""}` : "archived-row"} ${cursor}`}
        aria-expanded={row.expanded}
        onClick={props.onClick}
        {...props.place}
      >
        <span className="row-title muted">{words}</span>
        <span className="chips">
          {waiting > 0 && (
            <span className="chip tone-attention">
              {tc("tasks", "group.waitingOnYou")}: {waiting}
            </span>
          )}
        </span>
      </button>
    )
  }

  const task = row.task
  const running = task.rowStatus?.kind === "running"
  return (
    <button
      type="button"
      ref={tip.ref}
      className={`row task-row ${props.selected ? "is-selected" : ""} ${cursor} ${running ? "is-running" : ""}`}
      onClick={props.onClick}
      onContextMenu={props.onMenu}
      onPointerEnter={tip.onPointerEnter}
      onPointerLeave={tip.onPointerLeave}
      {...props.place}
      {...props.drag}
    >
      {tip.tip}
      {props.guides && (
        <span className="child-indent" aria-hidden="true">
          {props.guides.map((guide, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a column's place is its identity
            <span key={i} className={`guide is-${guide}`} />
          ))}
        </span>
      )}
      <span className="row-title">{rowTitle(task, props.tabs)}</span>
      <span className="chips">
        {row.level !== undefined && <span className="chip muted">{row.level}</span>}
        {(task.extraRepoCount ?? 0) > 0 && (
          <span className="chip muted" title={t("rail.extraRepos", { count: task.extraRepoCount ?? 0 })}>
            +{task.extraRepoCount}
          </span>
        )}
        {row.fold?.collapsed && (
          <FoldCount count={row.fold.count} urgent={props.foldUrgent} onUnfold={props.onToggleFold} />
        )}
        {task.pinned && <span className="chip muted">▴</span>}
        <PrChip tasks={props.prTasks ?? [task]} />
        {/* The right edge, as Claude Desktop's list: the row's state, then the cloud of a task elsewhere. */}
        <StatusDots status={task.rowStatus} />
        {props.cloud && <CloudMark label={props.cloud} />}
      </span>
    </button>
  )
}

/** `3 ●` on a folded task: how many descendants it hides and the most urgent of them; a click unfolds. No glyph: an open parent shows nothing, and the menu and the keyboard fold it. */
function FoldCount(props: { count: number; urgent?: RowStatus | undefined; onUnfold: () => void }) {
  const label = tc("tasks", "menu.expandChildren")
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: a button cannot nest in the row's button; the row's menu entry is the keyboard path
    // biome-ignore lint/a11y/useSemanticElements: same reason: the row is itself a button
    <span
      role="button"
      tabIndex={-1}
      aria-label={label}
      aria-expanded={false}
      className="chip fold-toggle muted"
      title={label}
      onClick={(e) => {
        e.stopPropagation()
        props.onUnfold()
      }}
    >
      {props.count}
      {props.urgent && <StatusDots status={props.urgent} />}
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
export function tabLabel(tab: TabRow): string {
  return tab.title ?? tab.engineName ?? (tab.kind === "engine" ? t("tab.engine") : t("tab.shell"))
}

/** The rows under a collapsed project header drop out until the next header. */
function foldProjects(rows: readonly NavRow[], collapsed: ReadonlySet<string>): readonly NavRow[] {
  if (collapsed.size === 0) return rows
  let hiding = false
  return rows.filter((row) => {
    if (row.kind === "project") {
      hiding = collapsed.has(row.id)
      return true
    }
    return !hiding
  })
}
