/** The Tasks rail: wordmark + inbox count, then project → task → tab rows (TUI `tree-panel`). */

import type { MouseEvent } from "react"
import { useEffect, useState } from "react"
import type { TabRow, TaskRow, TasksPayload } from "rove-bridge/protocol"
import { t, useLocale } from "./i18n/index.ts"
import { InboxDialog } from "./inbox-view.tsx"
import type { AppModel } from "./model.ts"
import { useRailFilters, useRailKeys } from "./rail-keys.ts"
import { type NavRow, SPINNER, activityGlyph, groupByProject, navRows, repoLabel } from "./rail.ts"
import { projectMenu, taskMenu } from "./row-actions.tsx"
import { useStore } from "./store.ts"
import { NewTaskDialog } from "./task-dialogs.tsx"
import { type MenuItem, dialog, menu } from "./ui.ts"

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
    const timer = window.setInterval(() => setFrame((f) => (f + 1) % SPINNER.length), 90)
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
  const groups = groupByProject(tasks, filters.sort)
  const rows = navRows(groups, tabsOf, tabLabel, filters.search.active ? filters.search.query : "")
  const keys = useRailKeys(model, rows, filters, {
    selectedId,
    onNewTask: (repo) => dialog.set(<NewTaskDialog model={model} repo={repo} />),
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
          onClick={() => dialog.set(<InboxDialog model={model} />)}
        >
          {t("rail.inbox", { count: unread })}
        </button>
      </header>
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
            onClick={() => {
              keys.setCursor(row.id)
              if (row.kind === "task") model.select(row.task.id)
              if (row.kind === "tab") model.select(row.task.id, row.tab.id)
            }}
            onMenu={(e) =>
              openMenu(
                e,
                row.kind === "project"
                  ? projectMenu(model, row.repo)
                  : taskMenu(model, row.task, row.kind === "tab" ? row.tab : null),
              )
            }
          />
        ))}
      </div>
      <button type="button" className="row new-task" onClick={() => dialog.set(<NewTaskDialog model={model} />)}>
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
  onClick: () => void
  onMenu: (e: MouseEvent) => void
}) {
  const { row } = props
  const cursor = props.cursor ? "is-cursor" : ""
  if (row.kind === "project") {
    return (
      <h2 className="project-head" title={row.repo} onContextMenu={props.onMenu}>
        <span>{repoLabel(row.repo)}</span>
        <span className="rule" />
      </h2>
    )
  }
  if (row.kind === "tab") {
    const tab = row.tab
    return (
      <button
        type="button"
        className={`row tab-row ${props.selected ? "is-selected" : ""} ${cursor}`}
        onClick={props.onClick}
        onContextMenu={props.onMenu}
      >
        <span className={`glyph ${tab.alive === false ? "tone-muted" : "tone-ink"}`}>
          {tab.alive === false ? "○" : "●"}
        </span>
        <span className="row-title">{tabLabel(tab)}</span>
      </button>
    )
  }
  const task = row.task
  const glyph = activityGlyph(task.activity?.state, props.frame)
  const changes = task.changes && "added" in task.changes ? task.changes : null
  return (
    <button
      type="button"
      className={`row task-row ${props.selected && props.tabCount === 0 ? "is-selected" : ""} ${cursor}`}
      title={task.branch || task.title}
      onClick={props.onClick}
      onContextMenu={props.onMenu}
    >
      <span className={`glyph tone-${glyph.tone}`}>{glyph.glyph}</span>
      <span className="row-title">{task.title}</span>
      <span className="chips">
        {task.pinned && <span className="chip muted">▴</span>}
        {changes && changes.added > 0 && <span className="chip tone-success">+{changes.added}</span>}
        {changes && changes.deleted > 0 && <span className="chip tone-attention">−{changes.deleted}</span>}
        {changes?.ahead ? <span className="chip muted">↑{changes.ahead}</span> : null}
        {task.prChip && <span className={`chip ${prTone(task.prChip, task.prChipStale)}`}>{prGlyph(task.prChip)}</span>}
      </span>
    </button>
  )
}

export function tabLabel(tab: TabRow): string {
  return tab.title ?? tab.engineName ?? (tab.kind === "shell" ? t("tab.shell") : t("tab.engine"))
}

function prGlyph(kind: NonNullable<TaskRow["prChip"]>): string {
  return kind === "conflict" ? "≠" : kind === "failing" ? "✗" : "✓"
}

function prTone(kind: NonNullable<TaskRow["prChip"]>, stale: boolean | undefined): string {
  if (stale) return "muted"
  return kind === "passing" ? "tone-success" : "tone-attention"
}
