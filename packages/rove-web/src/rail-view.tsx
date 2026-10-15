/** The Tasks rail: wordmark + inbox count, then project → task → tab rows (TUI `tree-panel`). */

import type { MouseEvent } from "react"
import { useEffect, useState } from "react"
import type { TabRow, TaskRow, TasksPayload } from "rove-bridge/protocol"
import { t, useLocale } from "./i18n/index.ts"
import { InboxDialog } from "./inbox-view.tsx"
import type { AppModel } from "./model.ts"
import { SPINNER, activityGlyph, groupByProject } from "./rail.ts"
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

  return (
    <nav className="rail">
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
      <div className="rail-body">
        {payload && tasks.length === 0 && (
          <div className="empty">
            <p>{t("rail.empty")}</p>
            <p className="muted">{t("rail.emptyHint")}</p>
          </div>
        )}
        {groupByProject(tasks).map((group) => (
          <section key={group.repo} className="project">
            <h2
              className="project-head"
              title={group.repo}
              onContextMenu={(e) => openMenu(e, projectMenu(model, group.repo))}
            >
              <span>{group.label}</span>
              <span className="rule" />
            </h2>
            {group.tasks.map((task) => (
              <TaskRows
                key={task.id}
                task={task}
                tabs={tabs[task.id] ?? []}
                frame={frame}
                selectedTask={selection.taskId === task.id}
                selectedTab={selection.taskId === task.id ? selection.tabId : null}
                onSelect={(tabId) => model.select(task.id, tabId)}
                onMenu={(e, tab) => openMenu(e, taskMenu(model, task, tab))}
              />
            ))}
          </section>
        ))}
      </div>
      <button type="button" className="row new-task" onClick={() => dialog.set(<NewTaskDialog model={model} />)}>
        <span className="glyph tone-accent">+</span>
        <span className="row-title">{t("rail.newTask")}</span>
      </button>
    </nav>
  )
}

function TaskRows(props: {
  task: TaskRow
  tabs: readonly TabRow[]
  frame: number
  selectedTask: boolean
  selectedTab: string | null
  onSelect: (tabId: string | null) => void
  onMenu: (e: MouseEvent, tab: TabRow | null) => void
}) {
  const { task, tabs, frame } = props
  const glyph = activityGlyph(task.activity?.state, frame)
  const changes = task.changes && "added" in task.changes ? task.changes : null
  return (
    <>
      <button
        type="button"
        className={`row task-row ${props.selectedTask && tabs.length === 0 ? "is-selected" : ""}`}
        title={task.branch || task.title}
        onClick={() => props.onSelect(null)}
        onContextMenu={(e) => props.onMenu(e, null)}
      >
        <span className={`glyph tone-${glyph.tone}`}>{glyph.glyph}</span>
        <span className="row-title">{task.title}</span>
        <span className="chips">
          {task.pinned && <span className="chip muted">▴</span>}
          {changes && changes.added > 0 && <span className="chip tone-success">+{changes.added}</span>}
          {changes && changes.deleted > 0 && <span className="chip tone-attention">−{changes.deleted}</span>}
          {changes?.ahead ? <span className="chip muted">↑{changes.ahead}</span> : null}
          {task.prChip && (
            <span className={`chip ${prTone(task.prChip, task.prChipStale)}`}>{prGlyph(task.prChip)}</span>
          )}
        </span>
      </button>
      {tabs.map((tab) => (
        <button
          type="button"
          key={tab.id}
          className={`row tab-row ${props.selectedTab === tab.id ? "is-selected" : ""}`}
          onClick={() => props.onSelect(tab.id)}
          onContextMenu={(e) => props.onMenu(e, tab)}
        >
          <span className={`glyph ${tab.alive === false ? "tone-muted" : "tone-ink"}`}>
            {tab.alive === false ? "○" : "●"}
          </span>
          <span className="row-title">{tabLabel(tab)}</span>
        </button>
      ))}
    </>
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
