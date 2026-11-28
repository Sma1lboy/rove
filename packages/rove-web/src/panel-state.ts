/**
 * What the side panel remembers: per task, its columns (per browser, in localStorage, for the newest
 * `REMEMBERED_TASKS` tasks), and the ways to bring a view up.
 */

import { type BrowserColumn, activateTab, closeTab } from "./browser-tabs.ts"
import { browserPanelKey, closeNativePanelTab, queueAdoptedTab } from "./desktop-browser.ts"
import { isNarrow } from "./layout.ts"
import { type PanelPush, applyPlan, planPanelPush } from "./panel-contract.ts"
import { narrowView, panelExpanded, panelOpen } from "./panel-layout.ts"
import {
  type PanelKind,
  type TaskPanel,
  closeColumn,
  columnOf,
  editBrowser,
  launch,
  showBrowser,
  showDiff,
  showFile,
  showKind,
} from "./panel-model.ts"
import { loadPanels, remember } from "./panel-storage.ts"
import { createStore, useStore } from "./store.ts"
import { type Preview, newSession, page } from "./ui.ts"

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
/** A task whose panel was never opened has none: another task's open panel must not hand it a Files column. */
const FRESH: TaskPanel = { columns: [], weights: {} }

export function useTaskPanel(taskId: string): TaskPanel {
  return useStore(panels)[taskId] ?? FRESH
}

/**
 * Whether the panel is on screen for this task (null = no local task, e.g. a remote one). Each task's
 * panel is its own: it shows while that task has a column, whatever any other task opened or closed,
 * and only beside the task itself, never beside the composer or a page.
 */
export function usePanelShown(taskId: string | null): boolean {
  const panel = useTaskPanel(taskId ?? "")
  const open = useStore(panelOpen)
  const elsewhere = useStore(newSession) !== null
  const onPage = useStore(page) !== null
  return open && !elsewhere && !onPage && (taskId === null || panel.columns.length > 0)
}

/** `usePanelShown` outside a component (what the page reports to the daemon). */
export function panelShown(taskId: string | null): boolean {
  if (!panelOpen.get() || newSession.get() !== null || page.get() !== null) return false
  return taskId === null || (panels.get()[taskId] ?? FRESH).columns.length > 0
}

/** Runs `fn` whenever any task's columns change. */
export const onPanelsChange = (fn: () => void): (() => void) => panels.subscribe(fn)

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

/** A launcher button in the workspace's top bar toggles its column. */
export function launchPanel(taskId: string, kind: PanelKind): void {
  const open = panelOpen.get()
  const next = launch(panels.get()[taskId] ?? FRESH, open, kind)
  editPanel(taskId, () => next.panel)
  // Closing this task's last column closes its panel only: the flag stays, so another task keeps its own.
  if (next.open) panelOpen.set(true)
  else panelExpanded.set(false)
}

/** A file's diff (`.` = the whole worktree) opens in the Diff column beside the terminal, not over it. */
export function openDiff(view: Preview): void {
  editPanel(view.taskId, (panel) => showDiff(panel, view.path, view.scope))
  panelOpen.set(true)
  if (isNarrow()) narrowView.set("diff")
}

/** A file from the Files tree opens as itself in a Browser tab, its path as the address. */
export function openFile(taskId: string, path: string): void {
  editPanel(taskId, (panel) => showFile(panel, path))
  panelOpen.set(true)
  if (isNarrow()) narrowView.set("browser")
}

/** An address opens in a Browser tab beside the terminal (the one already on it, else a blank one, else a new one). */
export function openBrowser(taskId: string, url: string): void {
  editPanel(taskId, (panel) => showBrowser(panel, url))
  panelOpen.set(true)
  if (isNarrow()) narrowView.set("browser")
}

/**
 * After a column went: this task's panel goes with its last one (and stops covering the terminal); the phone's panel always shows something,
 * so it falls back to Files when its kind is gone.
 */
function settleClosed(taskId: string, kind: PanelKind): void {
  const left = panels.get()[taskId] ?? FRESH
  if (!isNarrow() && left.columns.length === 0) panelExpanded.set(false)
  if (isNarrow() && narrowView.get() === kind && !columnOf(left, kind)) showPanel(taskId, "files")
}

export function closePanelColumn(taskId: string, kind: PanelKind): void {
  if (kind === "browser") {
    const col = columnOf(panels.get()[taskId] ?? FRESH, "browser")
    if (col?.kind === "browser") {
      for (const tab of col.tabs) closeNativePanelTab(taskId, tab.id)
    }
  }
  editPanel(taskId, (panel) => closeColumn(panel, kind))
  settleClosed(taskId, kind)
}

/** Edits the task's Browser column; closing its last tab closes the column. */
export function editBrowserColumn(taskId: string, edit: (col: BrowserColumn) => BrowserColumn | null): void {
  const before = columnOf(panels.get()[taskId] ?? FRESH, "browser")
  editPanel(taskId, (panel) => editBrowser(panel, edit))
  if (before?.kind === "browser") {
    const after = columnOf(panels.get()[taskId] ?? FRESH, "browser")
    const kept = new Set(after?.kind === "browser" ? after.tabs.map((t) => t.id) : [])
    for (const tab of before.tabs) {
      if (!kept.has(tab.id)) closeNativePanelTab(taskId, tab.id)
    }
  }
  settleClosed(taskId, "browser")
}

export function closeBrowserTab(taskId: string, id: string): void {
  editBrowserColumn(taskId, (col) => closeTab(col, id))
}

/** Open or focus a live desktop browser tab handed off from an agent (`rove api web tab handoff`). */
export function focusDesktopBrowserTab(opts: {
  readonly taskId: string
  readonly desktopTabId: string
  readonly panelKey?: string
  readonly url: string
}): void {
  const prefix = `${opts.taskId}:`
  if (opts.panelKey?.startsWith(prefix)) {
    const tabId = opts.panelKey.slice(prefix.length)
    editBrowserColumn(opts.taskId, (col) => activateTab(col, tabId))
    panelOpen.set(true)
    if (isNarrow()) narrowView.set("browser")
    return
  }
  editPanel(opts.taskId, (panel) => {
    const next = showBrowser(panel, opts.url)
    const col = columnOf(next, "browser")
    if (col?.kind === "browser") {
      queueAdoptedTab(browserPanelKey(opts.taskId, col.active), opts.desktopTabId)
    }
    return next
  })
  panelOpen.set(true)
  if (isNarrow()) narrowView.set("browser")
}

/**
 * A `rove api panel-show` request: every page keeps the view in the task's panel, whatever page is
 * open; only a page that is on that task opens the panel.
 */
export function applyPanelPush(push: PanelPush, hereTaskId: string | null): void {
  const plan = planPanelPush(push, { taskId: hereTaskId, narrow: isNarrow() })
  editPanel(push.taskId, (panel) => applyPlan(panel, plan, push.at))
  if (plan.show) panelOpen.set(true)
}
