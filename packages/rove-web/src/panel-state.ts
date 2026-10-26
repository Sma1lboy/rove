/**
 * What the side panel remembers: per task, the view it was last on and the Browser's last address
 * (per browser, in localStorage, for the newest `REMEMBERED_TASKS` tasks), and the ways to bring a view up.
 */

import { isNarrow } from "./layout.ts"
import { PANEL_TABS, type PanelTab, narrowView, panelOpen } from "./panel-layout.ts"
import { createStore, useStore } from "./store.ts"
import { type Preview, preview } from "./ui.ts"

const REMEMBERED_TASKS = 50

function taskMemory<T extends string>(key: string, valid: (value: unknown) => value is T) {
  let initial: Record<string, T> = {}
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key) ?? "{}")
    if (raw && typeof raw === "object") {
      initial = Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, T] => valid(entry[1])))
    }
  } catch {
    // A corrupt entry is a fresh start.
  }
  const store = createStore(initial)
  /** Writing a task moves it to the newest end, so the oldest fall off first. */
  const remember = (taskId: string, value: T): void => {
    const next = Object.fromEntries(Object.entries(store.get()).filter(([id]) => id !== taskId))
    next[taskId] = value
    for (const id of Object.keys(next).slice(0, -REMEMBERED_TASKS)) delete next[id]
    store.set(next)
    localStorage.setItem(key, JSON.stringify(next))
  }
  return { store, remember }
}

const tabs = taskMemory("rove.web.panelTab", (v): v is PanelTab => PANEL_TABS.some((tab) => tab === v))
const urls = taskMemory("rove.web.panelUrl", (v): v is string => typeof v === "string")

/** The Browser's last address per task (empty = none yet). */
export const panelUrls = urls.store
export const rememberUrl = urls.remember

/** The view the desktop panel shows for a task; in narrow mode the switch in the bar decides. */
export function usePanelTab(taskId: string, narrow: boolean): PanelTab {
  const remembered = useStore(tabs.store)[taskId] ?? "files"
  const narrowTab = useStore(narrowView)
  return narrow ? (narrowTab === "terminal" ? "files" : narrowTab) : remembered
}

/** Bring a view up: open the panel (and, narrow, leave the terminal for it). */
export function showPanel(taskId: string, tab: PanelTab): void {
  tabs.remember(taskId, tab)
  panelOpen.set(true)
  if (isNarrow()) narrowView.set(tab)
}

/** A file's diff (`.` = the whole worktree) opens in the Diff view beside the terminal, not over it. */
export function openDiff(view: Preview): void {
  preview.set(view)
  showPanel(view.taskId, "diff")
}

/** Closing the diff goes back to the file list it came from. */
export function closeDiff(taskId: string): void {
  preview.set(null)
  showPanel(taskId, "files")
}
