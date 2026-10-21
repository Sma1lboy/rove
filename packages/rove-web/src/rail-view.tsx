/** The Tasks rail: wordmark + inbox count, then project → task → tab rows (TUI `tree-panel`). */

import { en as tasksEn, zh as tasksZh } from "@sma1lboy/rove/src/tui/i18n/messages/tasks.ts"
import type { MouseEvent } from "react"
import { useEffect, useRef, useState } from "react"
import type { TabRow, TaskRow, TasksPayload } from "rove-bridge/protocol"
import { markHintUsed } from "./hint-state.ts"
import { t, useLocale } from "./i18n/index.ts"
import { InboxDialog } from "./inbox-view.tsx"
import { enterWorkspace, railFolded } from "./layout.ts"
import { type MachineRow, machineLabel, useMachines } from "./machines-view.tsx"
import type { AppModel } from "./model.ts"
import { moveMode } from "./move-mode.ts"
import { NewTaskDialog } from "./new-task-dialog.tsx"
import { PageNav } from "./pages-host.tsx"
import { ShortcutBadge } from "./prefix-guide.tsx"
import { type GlyphSet, usePrefs } from "./prefs.ts"
import { FoldButton, FoldedRail, PaneKeyHint, RailGrip, RecentRow } from "./rail-chrome.tsx"
import { useRailFilters, useRailKeys } from "./rail-keys.ts"
import { type NavRow, activityGlyph, railRows, repoLabel } from "./rail.ts"
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
  const { rows, groups } = build(filters.search.active ? filters.search.query : "")
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
    onSettings: () => dialog.set(<SettingsDialog client={model.client} />),
  })
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
        {rows.map((row) => {
          const machine = row.machine === undefined ? undefined : machines.find((m) => m.alias === row.machine)
          return (
            <RailRow
              key={row.id}
              row={row}
              machineChip={row.kind === "project" && machine ? machineChip(machine, words) : null}
              frame={frame}
              tabCount={row.kind === "task" ? tabsOf(row.task.id).length : 0}
              selected={row.id === selectedId}
              cursor={row.id === keys.cursor}
              stale={row.machine !== undefined && offline.has(row.machine)}
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
          )
        })}
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
  /** A remote project's header names its machine. */
  machineChip?: { readonly text: string; readonly title: string } | null
  frame: number
  tabCount: number
  selected: boolean
  cursor: boolean
  moving: boolean
  /** Its machine is unreachable: the last known state, greyed (TUI `task.origin.stale`). */
  stale: boolean
  onClick: () => void
  onMenu: (e: MouseEvent) => void
}) {
  const { row } = props
  const { prefs, glyphSets } = usePrefs()
  const glyphs: GlyphSet | undefined = glyphSets[prefs.glyphSet]
  const mark = useTaskColor(row.kind === "project" || row.kind === "routines" ? null : row.task.id)
  const cursor = `${props.cursor ? "is-cursor" : ""} ${props.moving ? "is-moving" : ""} ${props.stale ? "is-stale" : ""}`
  if (row.kind === "project") {
    return (
      <h2
        className={`project-head ${props.moving ? "is-moving" : ""} ${props.stale ? "is-stale" : ""}`}
        title={row.repo}
        onContextMenu={props.onMenu}
      >
        <span>{row.label}</span>
        {props.machineChip && (
          <span className="chip machine-chip" title={props.machineChip.title}>
            {props.machineChip.text}
          </span>
        )}
        <span className="rule" />
      </h2>
    )
  }
  const markDot = mark ? <span className="task-mark" style={{ background: mark }} aria-hidden="true" /> : null
  if (row.kind === "routines") {
    const waiting = row.expanded ? 0 : row.tasks.filter((task) => WAITING.has(task.activity?.state ?? "")).length
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
    const dead = tab.alive === false
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

/**
 * Every remote project carries this, so an online machine reads as just its name (`mac`); the version
 * and any trouble (`mac · offline`, `mac · ⚠ v0.9.100 (protocol mismatch)`) show only when they matter,
 * the full label always on hover.
 */
function machineChip(machine: MachineRow, words: Parameters<typeof machineLabel>[1]) {
  const title = machineLabel(machine, words)
  return { text: machine.state === "online" ? machine.hostLabel || machine.alias : title, title }
}

/** Sessions a closed fold flags: they need a person. */
const WAITING: ReadonlySet<string> = new Set(["permission_needed", "error", "dead", "rate_limited"])

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
