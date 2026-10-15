/**
 * What the page knows: the task feed (`tasks.subscribe` + `tasks` pushes), the
 * tabs of every task (the rail lists them all, like the TUI's always-expanded
 * tree), and which task/tab is open. Selection survives a reload.
 */

import type { TabRow, TaskRow, TasksPayload } from "rove-bridge/protocol"
import type { BridgeClient } from "./bridge.ts"
import { type Store, createStore } from "./store.ts"

export interface Selection {
  readonly taskId: string | null
  readonly tabId: string | null
}

const SELECTION_KEY = "rove.web.selection"
/** Pushes arrive in bursts while engines work; one tab sweep per burst is enough. */
const TAB_REFRESH_DEBOUNCE_MS = 300

function loadSelection(): Selection {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(SELECTION_KEY) ?? "null")
    if (raw && typeof raw === "object" && "taskId" in raw && typeof raw.taskId === "string") {
      return { taskId: raw.taskId, tabId: "tabId" in raw && typeof raw.tabId === "string" ? raw.tabId : null }
    }
  } catch {
    // A corrupt entry is just no selection.
  }
  return { taskId: null, tabId: null }
}

function isTasksPayload(data: unknown): data is TasksPayload {
  return !!data && typeof data === "object" && "tasks" in data && Array.isArray(data.tasks)
}

export class AppModel {
  readonly tasks: Store<TasksPayload | null> = createStore<TasksPayload | null>(null)
  readonly tabs: Store<Readonly<Record<string, readonly TabRow[]>>> = createStore({})
  readonly selection: Store<Selection> = createStore(loadSelection())
  private tabTimer: number | null = null

  constructor(readonly client: BridgeClient) {
    client.onOpen(() => {
      void client.request<TasksPayload>("tasks.subscribe").then((payload) => this.acceptTasks(payload))
    })
    client.on("tasks", (data) => {
      if (isTasksPayload(data)) this.acceptTasks(data)
    })
  }

  select(taskId: string, tabId: string | null = null): void {
    const tabs = this.tabs.get()[taskId] ?? []
    const next = { taskId, tabId: tabId ?? preferredTab(tabs)?.id ?? null }
    this.selection.set(next)
    localStorage.setItem(SELECTION_KEY, JSON.stringify(next))
  }

  private acceptTasks(payload: TasksPayload): void {
    this.tasks.set(payload)
    if (this.tabTimer !== null) return
    this.tabTimer = window.setTimeout(() => {
      this.tabTimer = null
      void this.refreshTabs(payload.tasks)
    }, TAB_REFRESH_DEBOUNCE_MS)
  }

  private async refreshTabs(tasks: readonly TaskRow[]): Promise<void> {
    const entries = await Promise.all(
      tasks
        .filter((task) => !task.deleting)
        .map(async (task) => {
          try {
            const { tabs } = await this.client.request<{ tabs: TabRow[] }>("task.tabs", { taskId: task.id })
            return [task.id, tabs] as const
          } catch {
            return [task.id, this.tabs.get()[task.id] ?? []] as const
          }
        }),
    )
    this.tabs.set(Object.fromEntries(entries))
    // A selected tab that closed falls back to the task's first live one, like the TUI.
    const { taskId, tabId } = this.selection.get()
    if (taskId === null) return
    const tabs = this.tabs.get()[taskId]
    if (tabs && !tabs.some((tab) => tab.id === tabId)) this.select(taskId)
  }
}

/** The tab a bare task click opens: the first live one, else the first. */
function preferredTab(tabs: readonly TabRow[]): TabRow | undefined {
  return tabs.find((tab) => tab.alive !== false) ?? tabs[0]
}
