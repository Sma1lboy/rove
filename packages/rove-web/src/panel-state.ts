/**
 * What the side panel remembers: per task, its columns (per browser, in localStorage, for the newest
 * `REMEMBERED_TASKS` tasks), and the ways to bring a view up.
 */

import { type BrowserColumn, closeTab } from "./browser-tabs.ts"
import { isNarrow } from "./layout.ts"
import { type PanelPush, applyPlan, planPanelPush } from "./panel-contract.ts"
import { narrowView, panelOpen } from "./panel-layout.ts"
import {
  type PanelKind,
  type TaskPanel,
  closeColumn,
  columnOf,
  editBrowser,
  launch,
  newPanel,
  showBrowser,
  showDiff,
  showFile,
  showKind,
} from "./panel-model.ts"
import { loadPanels, remember } from "./panel-storage.ts"
import { createStore, useStore } from "./store.ts"
import { type Preview, zen } from "./ui.ts"

const KEY = "rove.web.panels"
// What the panel kept before it had tabs: the view per task and the Browser's address per task.
const LEGACY_VIEW_KEY = "rove.web.panelTab"
const LEGACY_URL_KEY = "rove.web.panelUrl"

function readPanels(): Record<string, TaskPanel> {
  const legacy = { tab: localStorage.getItem(LEGACY_VIEW_KEY), url: localStorage.getItem(LEGACY_URL_KEY) }
  const panels = loadPanels(localStorage.getItem(KEY), legacy)
  if (legacy.tab !== null || legacy.url !== null) {
    localStorage.setItem(KEY, JSON.stringify(panels))
    localStorage.removeItem(LEGACY_VIEW_KEY)
    localStorage.removeItem(LEGACY_URL_KEY)
  }
  return panels
}

const panels = createStore(readPanels())
/** A task never seen: Files alone. */
const FRESH = newPanel()

export function useTaskPanel(taskId: string): TaskPanel {
  return useStore(panels)[taskId] ?? FRESH
}

/**
 * Whether the panel is on screen for this task (null = no local task, e.g. a remote one): it is open
 * only while the task has a column, whatever another task left the shared open flag at.
 */
export function usePanelShown(taskId: string | null): boolean {
  const panel = useTaskPanel(taskId ?? "")
  return useStore(panelOpen) && (taskId === null || panel.columns.length > 0)
}

/** Apply an edit to a task's panel and keep it; the task becomes the newest remembered. */
export function editPanel(taskId: string, edit: (panel: TaskPanel) => TaskPanel): void {
  const now = panels.get()[taskId] ?? FRESH
  const next = edit(now)
  if (next === now) return
  const all = remember(panels.get(), taskId, next)
  panels.set(all)
  localStorage.setItem(KEY, JSON.stringify(all))
}

/** Bring a kind of view up: open the panel (and, narrow, leave the terminal for it). */
export function showPanel(taskId: string, kind: PanelKind): void {
  editPanel(taskId, (panel) => showKind(panel, kind))
  panelOpen.set(true)
  if (isNarrow()) narrowView.set(kind)
}

/** A launcher button in the workspace's top bar toggles its column. Zen hides the panel, so from zen it opens rather than closes (and leaves zen). */
export function launchPanel(taskId: string, kind: PanelKind): void {
  const open = panelOpen.get()
  const next = launch(panels.get()[taskId] ?? FRESH, open && !zen.get(), kind, !open)
  editPanel(taskId, () => next.panel)
  panelOpen.set(next.open)
  if (next.open && zen.get()) zen.set(false)
}

/** A file's diff (`.` = the whole worktree) opens in the Diff column beside the terminal, not over it. */
export function openDiff(view: Preview): void {
  editPanel(view.taskId, (panel) => showDiff(panel, view.path, view.scope))
  panelOpen.set(true)
  // Zen hides the panel, and showing the diff is what was asked for (as `launchPanel` and a panel push do).
  if (zen.get()) zen.set(false)
  if (isNarrow()) narrowView.set("diff")
}

/** A file from the Files tree opens as itself in the File column, beside Files. */
export function openFile(taskId: string, path: string): void {
  editPanel(taskId, (panel) => showFile(panel, path))
  panelOpen.set(true)
  if (zen.get()) zen.set(false)
  if (isNarrow()) narrowView.set("file")
}

/** An address opens in a Browser tab beside the terminal (the one already on it, else a blank one, else a new one). */
export function openBrowser(taskId: string, url: string): void {
  editPanel(taskId, (panel) => showBrowser(panel, url))
  panelOpen.set(true)
  if (zen.get()) zen.set(false)
  if (isNarrow()) narrowView.set("browser")
}

/**
 * After a column went: the panel goes with its last one; the phone's panel always shows something,
 * so it falls back to Files when its kind is gone.
 */
function settleClosed(taskId: string, kind: PanelKind): void {
  const left = panels.get()[taskId] ?? FRESH
  if (!isNarrow() && left.columns.length === 0) panelOpen.set(false)
  if (isNarrow() && narrowView.get() === kind && !columnOf(left, kind)) showPanel(taskId, "files")
}

export function closePanelColumn(taskId: string, kind: PanelKind): void {
  editPanel(taskId, (panel) => closeColumn(panel, kind))
  settleClosed(taskId, kind)
}

/** Edits the task's Browser column; closing its last tab closes the column. */
export function editBrowserColumn(taskId: string, edit: (col: BrowserColumn) => BrowserColumn | null): void {
  editPanel(taskId, (panel) => editBrowser(panel, edit))
  settleClosed(taskId, "browser")
}

export function closeBrowserTab(taskId: string, id: string): void {
  editBrowserColumn(taskId, (col) => closeTab(col, id))
}

/**
 * A `rove api panel-show` request: every page keeps the view in the task's panel, whatever page is
 * open; only a page that is on that task opens the panel.
 */
export function applyPanelPush(push: PanelPush, hereTaskId: string | null): void {
  const plan = planPanelPush(push, { taskId: hereTaskId, narrow: isNarrow() })
  editPanel(push.taskId, (panel) => applyPlan(panel, plan, push.at))
  if (plan.show) {
    panelOpen.set(true)
    // Zen hides the panel, and showing it is what was asked for: leave zen, as the panel's own button does.
    if (zen.get()) zen.set(false)
  }
}
