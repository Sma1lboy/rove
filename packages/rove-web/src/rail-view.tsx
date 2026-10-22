/** The Tasks rail: wordmark + inbox count, then project → task → tab rows (TUI `tree-panel`). */

import { en as tasksEn, zh as tasksZh } from "@sma1lboy/rove/src/tui/i18n/messages/tasks.ts"
import type { DragEvent, HTMLAttributes, MouseEvent } from "react"
import { useEffect, useRef, useState } from "react"
import type { TabRow, TaskRow, TasksPayload } from "rove-bridge/protocol"
import { markHintUsed } from "./hint-state.ts"
import { t, useLocale } from "./i18n/index.ts"
import { InboxDialog } from "./inbox-view.tsx"
import { enterWorkspace, railFolded } from "./layout.ts"
import { CloudMark, rowCloud, useMachines } from "./machines-view.tsx"
import type { AppModel } from "./model.ts"
import { moveMode, moveTaskBy } from "./move-mode.ts"
import { NewTaskDialog } from "./new-task-dialog.tsx"
import { PageNav } from "./pages-host.tsx"
import { ShortcutBadge } from "./prefix-guide.tsx"
import { type GlyphSet, usePrefs } from "./prefs.ts"
import { FoldButton, FoldedRail, PaneKeyHint, RailGrip, RecentRow } from "./rail-chrome.tsx"
import { useRailFilters, useRailKeys } from "./rail-keys.ts"
import {
  type NavRow,
  anySpinning,
  dragSteps,
  needsPerson,
  railRows,
  repoLabel,
  tabRowGlyph,
  taskRowGlyph,
} from "./rail.ts"
import { type ProjectInfo, projectMenu, taskMenu } from "./row-actions.tsx"
import { SettingsDialog } from "./settings-view.tsx"
import { useStore } from "./store.ts"
import { useTaskColor } from "./task-colors.ts"
import { tc } from "./tui-copy.ts"
import { type MenuItem, dialog, menu } from "./ui.ts"
import "./taskops.css"
import { UpdateChip } from "./update-view.tsx"

/** Frames a spinner counts to before it wraps: a multiple of every preset's frame count (10, 8, 4). */
const SPINNER_CYCLE = 120
/** The braille preset's PR marks, for the first frames before the bridge sends the glyph sets. */
const BRAILLE_MARKS = { conflict: "≠", checksFailing: "✗", checksPassing: "✓" }

/** Right click opens the row's menu where the pointer is (TUI tree menu). */
export function openMenu(e: MouseEvent, items: readonly MenuItem[]): void {
  e.preventDefault()
  // A keyboard contextmenu (Shift+F10) reports button 0; a right click reports 2.
  menu.set({ x: e.clientX, y: e.clientY, items, target: e.currentTarget as Element, fromKeyboard: e.button !== 2 })
}

/** One shared spinner clock, only ticking while some row runs. */
function useSpinnerFrame(running: boolean): number {
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => setFrame((f) => (f + 1) % SPINNER_CYCLE), 90)
    return () => window.clearInterval(timer)
  }, [running])
  return frame
}

export function RailView({ model, narrow }: { model: AppModel; narrow: boolean }) {
  const locale = useLocale()
  const payload: TasksPayload | null = useStore(model.tasks)
  const remoteTasks = useStore(model.remote)
  const machines = useMachines(model)
  const tabs = useStore(model.tabs)
  const selection = useStore(model.selection)
  const tasks = payload?.tasks ?? []
  const frame = useSpinnerFrame(anySpinning(tasks) || anySpinning(remoteTasks))
  const unread = payload?.attention.filter((row) => row.unread).length ?? 0
  const tabsOf = (taskId: string) => tabs[taskId] ?? []
  const selectedId = selection.taskId
    ? selection.tabId && tabsOf(selection.taskId).some((tab) => tab.id === selection.tabId)
      ? `${selection.taskId}::${selection.tabId}`
      : selection.taskId
    : null

  const filters = useRailFilters()
  const moving = useStore(moveMode)
  const build = (query: string) =>
    railRows({
      tasks,
      remote: remoteTasks,
      machines,
      sort: filters.sort,
      tabsOf,
      tabLabel,
      query,
      routines: filters.routines,
    })
  const built = build(filters.search.active ? filters.search.query : "")
  const { groups } = built
  // A collapsed project keeps its header and hides what is under it; search shows everything.
  const rows = filters.search.active
    ? built.rows
    : foldProjects(dropIdleProjects(built.rows, tabs, selection.taskId), filters.collapsed)
  // A task whose tabs are listed under it leaves the status to them (`taskRowGlyph`).
  const tabsShown = new Set(rows.flatMap((row) => (row.kind === "tab" ? [row.task.id] : [])))
  const stops = (all: readonly NavRow[]) => all.filter((row) => row.kind !== "project")
  const words = (locale === "zh" ? tasksZh : tasksEn).machine
  const offline = new Set(machines.filter((m) => m.state !== "online").map((m) => m.alias))
  const firstMovable = groups.find((group) => group.tasks.some((task) => task.kind === "main"))?.repo
  const projectInfo = (repo: string): ProjectInfo => ({
    mainTaskId: groups.find((group) => group.repo === repo)?.tasks.find((task) => task.kind === "main")?.id ?? null,
    label: repoLabel(repo),
    first: repo === firstMovable,
  })
  const keys = useRailKeys(model, rows, filters, {
    selectedId,
    onNewTask: (repo, machine) => dialog.set(<NewTaskDialog model={model} repo={repo} machine={machine} />),
    onSettings: () => dialog.set(<SettingsDialog model={model} />),
  })
  const drag = useRowDrag(model, tasks, filters.sort === "default" && !filters.search.active, projectInfo)
  const total = stops(build("").rows).length
  const rail = useRef<HTMLElement>(null)
  const folded = useStore(railFolded) && !narrow
  const recent = narrow ? (tasks.find((task) => task.id === selection.taskId && !task.deleting) ?? null) : null
  if (folded) {
    return (
      <nav className="rail is-folded" ref={rail}>
        <FoldedRail model={model} frame={frame} selectedTaskId={selection.taskId} />
        <FoldButton folded />
      </nav>
    )
  }

  return (
    <nav
      className="rail"
      ref={rail}
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
          <span className="muted">{t("taskops.moveHint")}</span>
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
      <div className="rail-body">
        {payload && tasks.length === 0 && remoteTasks.length === 0 && (
          <div className="empty">
            <p>{t("rail.empty")}</p>
            <p className="muted">{t("rail.emptyHint")}</p>
          </div>
        )}
        {recent && <RecentRow title={recent.title} />}
        {rows.map((row) => (
          <RailRow
            key={row.id}
            row={row}
            cloud={rowCloud(row, machines, words)}
            frame={frame}
            tabCount={row.kind === "task" ? tabsOf(row.task.id).length : 0}
            tabsShown={row.kind === "task" && tabsShown.has(row.task.id)}
            selected={row.id === selectedId}
            cursor={row.id === keys.cursor}
            stale={row.machine !== undefined && offline.has(row.machine)}
            collapsed={row.kind === "project" && filters.collapsed.has(row.id)}
            drag={drag.props(row)}
            dropTarget={drag.over?.id === row.id ? drag.over.side : null}
            onNewTask={
              row.kind === "project"
                ? () => dialog.set(<NewTaskDialog model={model} repo={row.repo} machine={row.machine} />)
                : undefined
            }
            moving={
              moving &&
              row.machine === undefined &&
              (row.kind === "project"
                ? projectInfo(row.repo).mainTaskId === keys.cursor
                : row.id === keys.cursor && !(row.kind === "task" && row.task.kind === "main"))
            }
            onClick={() => {
              keys.setCursor(row.id)
              if (row.kind === "routines") filters.toggleRoutines(row.key)
              if (row.kind === "project") filters.toggleProject(row.id)
              if (row.kind === "task") model.select(row.task.id)
              if (row.kind === "tab") model.select(row.task.id, row.tab.id)
              if (row.kind !== "project") enterWorkspace()
            }}
            onMenu={(e) => {
              // Another machine's project has no checkout here, so its header has no menu; its
              // tasks and tabs do (their verbs run on that machine, `taskMenu` drops the local-only ones).
              if (row.machine !== undefined && row.kind === "project") return
              // The menu's target is the cursor, as the TUI's (a project header stands in with its main row).
              if (row.kind === "project") {
                const info = projectInfo(row.repo)
                if (info.mainTaskId) keys.setCursor(info.mainTaskId)
                openMenu(e, projectMenu(model, row.repo, info))
                return
              }
              // The routines row names no task, so it has no menu (TUI `use-tree-menu`).
              if (row.kind === "routines") return
              keys.setCursor(row.id)
              openMenu(e, taskMenu(model, row.task, row.kind === "tab" ? row.tab : null))
            }}
          />
        ))}
      </div>
      <PaneKeyHint pane="sidebar" />
      <div className="badge-host">
        <button type="button" className="row new-task" onClick={() => dialog.set(<NewTaskDialog model={model} />)}>
          <span className="glyph tone-accent">+</span>
          <span className="row-title">{t("rail.newTask")}</span>
        </button>
        <ShortcutBadge model={model} bindingId="task.new.global" />
      </div>
      {!narrow && <FoldButton folded={false} />}
      {!narrow && <RailGrip rail={rail} />}
    </nav>
  )
}

function RailRow(props: {
  row: NavRow
  /** A task on another machine: its cloud mark's text (`on mac · offline`); null for this machine's rows. */
  cloud: string | null
  frame: number
  tabCount: number
  /** The task's tab rows are on screen under it. */
  tabsShown: boolean
  selected: boolean
  cursor: boolean
  moving: boolean
  /** Its machine is unreachable: the last known state, greyed (TUI `task.origin.stale`). */
  stale: boolean
  /** Drag-to-reorder handlers, on a row that can move. */
  drag?: DragProps
  /** A dragged row would land here, taking this row's place from above or below. */
  dropTarget: "above" | "below" | null
  /** A project header whose rows are folded away. */
  collapsed?: boolean
  /** A project header's +: a new task in that project. */
  onNewTask?: () => void
  onClick: () => void
  onMenu: (e: MouseEvent) => void
}) {
  const { row } = props
  const { prefs, glyphSets } = usePrefs()
  const glyphs: GlyphSet | undefined = glyphSets[prefs.glyphSet]
  const mark = useTaskColor(row.kind === "project" || row.kind === "routines" ? null : row.task.id)
  const drop = props.dropTarget ? `is-drop-${props.dropTarget}` : ""
  const cursor = `${props.cursor ? "is-cursor" : ""} ${props.moving ? "is-moving" : ""} ${props.stale ? "is-stale" : ""} ${drop}`
  if (row.kind === "project") {
    return (
      <h2
        className={`project-head ${props.moving ? "is-moving" : ""} ${props.stale ? "is-stale" : ""} ${drop}`}
        onContextMenu={props.onMenu}
        {...props.drag}
      >
        <button
          type="button"
          className="project-toggle"
          title={row.repo}
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
  const markDot = mark ? <span className="task-mark" style={{ background: mark }} aria-hidden="true" /> : null
  if (row.kind === "routines") {
    const waiting = row.expanded ? 0 : row.tasks.filter(needsPerson).length
    return (
      <button
        type="button"
        className={`row routines-row ${props.selected ? "is-selected" : ""} ${cursor}`}
        aria-expanded={row.expanded}
        onClick={props.onClick}
      >
        <span className="glyph tone-muted">{row.expanded ? "▾" : "▸"}</span>
        <span className="row-title muted">{tc("tasks", "routinesRow", { count: row.tasks.length })}</span>
        {waiting > 0 && (
          <span className="chip tone-attention">
            {tc("tasks", "group.waitingOnYou")}: {waiting}
          </span>
        )}
      </button>
    )
  }
  if (row.kind === "tab") {
    const tab = row.tab
    const glyph = tabRowGlyph(row.task, tab, props.frame, glyphs)
    // Two-row tabs add the engine running in the tab (the pty's foreground process, none when unknown) under its label (TUI `tabRowHeight` 2).
    const caption = prefs.tabRowHeight === 2 && tab.kind === "engine" ? (tab.liveEngine ?? null) : null
    return (
      <button
        type="button"
        className={`row tab-row ${props.selected ? "is-selected" : ""} ${cursor} ${caption ? "is-two-row" : ""}`}
        onClick={props.onClick}
        onContextMenu={props.onMenu}
      >
        {markDot}
        <span className={`glyph tone-${glyph.tone}`}>{glyph.glyph}</span>
        <span className="row-title">
          {tabLabel(tab)}
          {caption && <span className="row-caption muted">{caption}</span>}
        </span>
      </button>
    )
  }
  const task = row.task
  const glyph = taskRowGlyph(task, props.frame, glyphs)
  const running = task.rowStatus?.kind === "running"
  return (
    <button
      type="button"
      className={`row task-row ${props.selected && props.tabCount === 0 ? "is-selected" : ""} ${cursor} ${running ? "is-running" : ""}`}
      title={task.branch || task.title}
      onClick={props.onClick}
      onContextMenu={props.onMenu}
      {...props.drag}
    >
      {markDot}
      <span className="row-title">{task.title}</span>
      <span className="chips">
        {task.pinned && <span className="chip muted">▴</span>}
        {task.prChip && (
          <span className={`chip ${prTone(task.prChip, task.prChipStale)}`}>{prGlyph(task.prChip, glyphs)}</span>
        )}
        {/* The right edge, as Claude Desktop's list: a job or deletion spinner, then the cloud of a task elsewhere. */}
        {glyph && <span className={`glyph tone-${glyph.tone}`}>{glyph.glyph}</span>}
        {props.cloud && <CloudMark label={props.cloud} />}
      </span>
    </button>
  )
}

type DragProps = Pick<
  HTMLAttributes<HTMLElement>,
  "draggable" | "onDragStart" | "onDragEnd" | "onDragOver" | "onDragLeave" | "onDrop"
>

/**
 * Drag a project header among projects, or a task among its project's tasks (same pin), as the
 * TUI's move mode does with keys. Only in the default sort, where the rail shows the moved order.
 */
function useRowDrag(
  model: AppModel,
  tasks: readonly TaskRow[],
  enabled: boolean,
  projectInfo: (repo: string) => ProjectInfo,
) {
  // A ref, not state: the first dragover can arrive before the dragstart's render.
  const dragging = useRef<TaskRow | null>(null)
  const [over, setOver] = useState<{ id: string; side: "above" | "below" } | null>(null)
  const end = () => {
    dragging.current = null
    setOver(null)
  }
  const taskOf = (row: NavRow): TaskRow | null => {
    if (!enabled || row.machine !== undefined) return null
    if (row.kind === "project") return tasks.find((task) => task.id === projectInfo(row.repo).mainTaskId) ?? null
    return row.kind === "task" && row.task.kind !== "main" ? row.task : null
  }
  const props = (row: NavRow): DragProps | undefined => {
    const task = taskOf(row)
    if (!task) return undefined
    const steps = () => (dragging.current ? dragSteps(tasks, dragging.current, task) : null)
    return {
      draggable: true,
      onDragStart: (e: DragEvent) => {
        e.dataTransfer.effectAllowed = "move"
        e.dataTransfer.setData("text/plain", task.id)
        dragging.current = task
      },
      onDragEnd: end,
      onDragOver: (e: DragEvent) => {
        const n = steps()
        if (n === null) return
        e.preventDefault()
        if (over?.id !== row.id) setOver({ id: row.id, side: n < 0 ? "above" : "below" })
      },
      onDragLeave: () => setOver((at) => (at?.id === row.id ? null : at)),
      onDrop: (e: DragEvent) => {
        e.preventDefault()
        const n = steps()
        if (dragging.current && n) void moveTaskBy(model, dragging.current.id, n)
        end()
      },
    }
  }
  return { props, over }
}

export function tabLabel(tab: TabRow): string {
  return tab.title ?? tab.engineName ?? (tab.kind === "engine" ? t("tab.engine") : t("tab.shell"))
}

function prGlyph(kind: NonNullable<TaskRow["prChip"]>, glyphs: GlyphSet | undefined): string {
  const set = glyphs ?? BRAILLE_MARKS
  return kind === "conflict" ? set.conflict : kind === "failing" ? set.checksFailing : set.checksPassing
}

function prTone(kind: NonNullable<TaskRow["prChip"]>, stale: boolean | undefined): string {
  if (stale) return "muted"
  return kind === "passing" ? "tone-success" : "tone-attention"
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

/**
 * A project with nothing going on (only its repo row, no tab open, not selected) is not listed,
 * as Claude's sidebar lists only projects with sessions; New task still reaches it.
 */
function dropIdleProjects(
  rows: readonly NavRow[],
  tabs: Readonly<Record<string, readonly unknown[]>>,
  selectedTaskId: string | null,
): readonly NavRow[] {
  const out: NavRow[] = []
  for (let i = 0; i < rows.length; i++) {
    const head = rows[i]
    if (head?.kind !== "project") {
      if (head) out.push(head)
      continue
    }
    let end = i + 1
    while (end < rows.length && rows[end]?.kind !== "project") end++
    const under = rows.slice(i + 1, end)
    const idle = under.every(
      (row) =>
        row.kind === "task" &&
        row.task.kind === "main" &&
        row.task.id !== selectedTaskId &&
        // Only a tab list that arrived and is empty: unknown (not loaded, or the read failed) keeps the project.
        tabs[row.task.id]?.length === 0,
    )
    if (!idle) out.push(head, ...under)
    i = end - 1
  }
  return out
}
