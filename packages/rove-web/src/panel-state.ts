/**
 * What the side panel remembers: per task, its tabs and split (per browser, in localStorage, for the
 * newest `REMEMBERED_TASKS` tasks), and the ways to bring a view up.
 */

import { isNarrow } from "./layout.ts"
import { type PanelPush, applyPlan, planPanelPush } from "./panel-contract.ts"
import { type PanelKind, narrowView, panelOpen } from "./panel-layout.ts"
import {
  type TaskPanel,
  closeTab,
  latestOfKind,
  loadPanels,
  newPanel,
  remember,
  showDiff,
  showKind,
} from "./panel-model.ts"
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

/** A file's diff (`.` = the whole worktree) opens in its own tab beside the terminal, not over it. */
export function openDiff(view: Preview): void {
  editPanel(view.taskId, (panel) => showDiff(panel, view.path, view.scope))
  panelOpen.set(true)
  if (isNarrow()) narrowView.set("diff")
}

/** Closes a tab; the phone's panel always shows something, so it falls back to Files when its kind runs out. */
export function closePanelTab(taskId: string, id: string): void {
  editPanel(taskId, (panel) => closeTab(panel, id))
  const kind = narrowView.get()
  if (isNarrow() && kind !== "terminal" && !latestOfKind(panels.get()[taskId] ?? FRESH, kind))
    showPanel(taskId, "files")
}

/**
 * A `rove api panel-show` request: every page keeps the view in the task's panel, whatever page is
 * open; only a page that is on that task opens the panel.
 */
export function applyPanelPush(push: PanelPush, hereTaskId: string | null): void {
  const plan = planPanelPush(push, { taskId: hereTaskId, narrow: isNarrow() })
  editPanel(push.taskId, (panel) => applyPlan(panel, plan))
  if (plan.show) {
    panelOpen.set(true)
    // Zen hides the panel, and showing it is what was asked for: leave zen, as the panel's own button does.
    if (zen.get()) zen.set(false)
  }
}
