/** The Tasks rail: wordmark + inbox count, then project → task → tab rows (TUI `tree-panel`). */

import type { MouseEvent } from "react"
import { useEffect, useState } from "react"
import type { TabRow, TaskRow, TasksPayload } from "rove-bridge/protocol"
import { t, useLocale } from "./i18n/index.ts"
import { InboxDialog } from "./inbox-view.tsx"
import { MachineHeaders } from "./machines-view.tsx"
import type { AppModel } from "./model.ts"
import { moveMode } from "./move-mode.ts"
import { PageNav } from "./pages-host.tsx"
import { type GlyphSet, usePrefs } from "./prefs.ts"
import { useRailFilters, useRailKeys } from "./rail-keys.ts"
import { type NavRow, activityGlyph, groupByProject, navRows, repoLabel } from "./rail.ts"
import { type ProjectInfo, projectMenu, taskMenu } from "./row-actions.tsx"
import { SettingsDialog } from "./settings-view.tsx"
import { useStore } from "./store.ts"
import { useTaskColor } from "./task-colors.ts"
import { NewTaskDialog } from "./task-dialogs.tsx"
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
  menu.set({ x: e.clientX, y: e.clientY, items })
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

export function RailView({ model }: { model: AppModel }) {
  useLocale()
  const payload: TasksPayload | null = useStore(model.tasks)
  const tabs = useStore(model.tabs)
  const selection = useStore(model.selection)
  const tasks = payload?.tasks ?? []
  const frame = useSpinnerFrame(tasks.some((task) => task.activity?.state === "running"))
  const unread = payload?.attention.filter((row) => row.unread).length ?? 0
  const tabsOf = (taskId: string) => tabs[taskId] ?? []
  const selectedId = selection.taskId
    ? selection.tabId && tabsOf(selection.taskId).some((tab) => tab.id === selection.tabId)
      ? `${selection.taskId}::${selection.tabId}`
      : selection.taskId
    : null

  const filters = useRailFilters()
  const moving = useStore(moveMode)
  const groups = groupByProject(tasks, filters.sort)
  const rows = navRows(groups, tabsOf, tabLabel, filters.search.active ? filters.search.query : "")
  const firstMovable = groups.find((group) => group.tasks.some((task) => task.kind === "main"))?.repo
  const projectInfo = (repo: string): ProjectInfo => ({
    mainTaskId: groups.find((group) => group.repo === repo)?.tasks.find((task) => task.kind === "main")?.id ?? null,
    label: repoLabel(repo),
    first: repo === firstMovable,
  })
  const keys = useRailKeys(model, rows, filters, {
    selectedId,
    onNewTask: (repo) => dialog.set(<NewTaskDialog model={model} repo={repo} />),
    onSettings: () => dialog.set(<SettingsDialog client={model.client} />),
  })
  const total = navRows(groups, tabsOf, tabLabel).filter((row) => row.kind !== "project").length

  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: the rail takes the TUI sidebar's keys while focused
    <nav className="rail" tabIndex={0} onKeyDown={keys.onKeyDown}>
      <header className="rail-head">
        <span className="wordmark">
          <span className="bracket">[</span> rove <span className="bracket">]</span>
        </span>
        <button
          type="button"
          className={`kicker inbox-chip ${unread > 0 ? "is-accent" : ""}`}
          data-binding="inbox.show"
          onClick={() => dialog.set(<InboxDialog model={model} />)}
        >
          {t("rail.inbox", { count: unread })}
        </button>
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
            {filters.search.query
              ? `${rows.filter((row) => row.kind !== "project").length}/${total}`
              : t("rail.searchPlaceholder")}
          </span>
        </div>
      )}
      <PageNav />
      <div className="rail-body">
        {payload && tasks.length === 0 && (
          <div className="empty">
            <p>{t("rail.empty")}</p>
            <p className="muted">{t("rail.emptyHint")}</p>
          </div>
        )}
        {rows.map((row) => (
          <RailRow
            key={row.id}
            row={row}
            frame={frame}
            tabCount={row.kind === "task" ? tabsOf(row.task.id).length : 0}
            selected={row.id === selectedId}
            cursor={row.id === keys.cursor}
            moving={
              moving &&
              (row.kind === "project"
                ? projectInfo(row.repo).mainTaskId === keys.cursor
                : row.id === keys.cursor && !(row.kind === "task" && row.task.kind === "main"))
            }
            onClick={() => {
              keys.setCursor(row.id)
              if (row.kind === "task") model.select(row.task.id)
              if (row.kind === "tab") model.select(row.task.id, row.tab.id)
            }}
            onMenu={(e) => {
              // The menu's target is the cursor, as the TUI's (a project header stands in with its main row).
              if (row.kind === "project") {
                const info = projectInfo(row.repo)
                if (info.mainTaskId) keys.setCursor(info.mainTaskId)
                openMenu(e, projectMenu(model, row.repo, info))
                return
              }
              keys.setCursor(row.id)
              openMenu(e, taskMenu(model, row.task, row.kind === "tab" ? row.tab : null))
            }}
          />
        ))}
        <MachineHeaders client={model.client} />
      </div>
      <button
        type="button"
        className="row new-task"
        data-binding="task.new.global"
        onClick={() => dialog.set(<NewTaskDialog model={model} />)}
      >
        <span className="glyph tone-accent">+</span>
        <span className="row-title">{t("rail.newTask")}</span>
      </button>
    </nav>
  )
}

function RailRow(props: {
  row: NavRow
  frame: number
  tabCount: number
  selected: boolean
  cursor: boolean
  moving: boolean
  onClick: () => void
  onMenu: (e: MouseEvent) => void
}) {
  const { row } = props
  const { prefs, glyphSets } = usePrefs()
  const glyphs: GlyphSet | undefined = glyphSets[prefs.glyphSet]
  const mark = useTaskColor(row.kind === "project" ? null : row.task.id)
  const cursor = `${props.cursor ? "is-cursor" : ""} ${props.moving ? "is-moving" : ""}`
  if (row.kind === "project") {
    return (
      <h2 className={`project-head ${props.moving ? "is-moving" : ""}`} title={row.repo} onContextMenu={props.onMenu}>
        <span>{repoLabel(row.repo)}</span>
        <span className="rule" />
      </h2>
    )
  }
  const markDot = mark ? <span className="task-mark" style={{ background: mark }} aria-hidden="true" /> : null
  if (row.kind === "tab") {
    const tab = row.tab
    const dead = tab.alive === false
    // Two-row tabs add the engine running in the tab under its label (TUI `tabRowHeight` 2).
    const caption = prefs.tabRowHeight === 2 && tab.kind === "engine" ? tab.engineName : null
    return (
      <button
        type="button"
        className={`row tab-row ${props.selected ? "is-selected" : ""} ${cursor} ${caption ? "is-two-row" : ""}`}
        onClick={props.onClick}
        onContextMenu={props.onMenu}
      >
        {markDot}
        <span className={`glyph ${dead ? "tone-muted" : "tone-ink"}`}>
          {dead ? (glyphs?.idle ?? "○") : (glyphs?.running ?? "●")}
        </span>
        <span className="row-title">
          {tabLabel(tab)}
          {caption && <span className="row-caption muted">{caption}</span>}
        </span>
      </button>
    )
  }
  const task = row.task
  const glyph = activityGlyph(task.activity?.state, props.frame, glyphs)
  const changes = task.changes && "added" in task.changes ? task.changes : null
  const running = task.activity?.state === "running"
  return (
    <button
      type="button"
      className={`row task-row ${props.selected && props.tabCount === 0 ? "is-selected" : ""} ${cursor} ${running ? "is-running" : ""}`}
      title={task.branch || task.title}
      onClick={props.onClick}
      onContextMenu={props.onMenu}
    >
      {markDot}
      <span className={`glyph tone-${glyph.tone}`}>{glyph.glyph}</span>
      <span className="row-title">{task.title}</span>
      <span className="chips">
        {task.pinned && <span className="chip muted">▴</span>}
        {changes && changes.added > 0 && <span className="chip tone-diff-added">+{changes.added}</span>}
        {changes && changes.deleted > 0 && <span className="chip tone-diff-removed">−{changes.deleted}</span>}
        {changes?.ahead ? <span className="chip muted">↑{changes.ahead}</span> : null}
        {task.prChip && (
          <span className={`chip ${prTone(task.prChip, task.prChipStale)}`}>{prGlyph(task.prChip, glyphs)}</span>
        )}
      </span>
    </button>
  )
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
