/**
 * What the page knows: the task feed (`tasks.subscribe` + `tasks` pushes), the
 * tabs of every task (the rail lists them all, like the TUI's always-expanded
 * tree), and which task/tab is open. Selection survives a reload.
 */

import type { TabRow, TaskRow, TasksPayload } from "rove-bridge/protocol"
import type { BridgeClient } from "./bridge.ts"
import { type Store, createStore } from "./store.ts"
import { toast } from "./ui.ts"

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

export interface Visit {
  readonly taskId: string
  readonly tabId: string | null
  readonly at: number
}

const VISITS_KEY = "rove.web.visits"
const VISITS_MAX = 20

function loadVisits(): readonly Visit[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(VISITS_KEY) ?? "[]")
    return Array.isArray(raw)
      ? raw.filter((v): v is Visit => !!v && typeof v === "object" && typeof v.taskId === "string")
      : []
  } catch {
    return []
  }
}

export class AppModel {
  /** This Mac's rows only: every action and page reads these, so nothing aims a verb at another machine's task. */
  readonly tasks: Store<TasksPayload | null> = createStore<TasksPayload | null>(null)
  /** Other registered machines' rows (`machine` set): listed under their header, read-only, as the TUI. */
  readonly remote: Store<readonly TaskRow[]> = createStore<readonly TaskRow[]>([])
  readonly tabs: Store<Readonly<Record<string, readonly TabRow[]>>> = createStore({})
  readonly selection: Store<Selection> = createStore(loadSelection())
  /** Newest first; the Inbox's RECENT section (the TUI keeps its own the same way, per client). */
  readonly visits: Store<readonly Visit[]> = createStore(loadVisits())
  private tabTimer: number | null = null
  /** Bumped per sweep; a sweep resolving after a newer one started commits nothing. */
  private tabSweep = 0
  /** A task just created here: select it once the feed lists it. */
  private pendingSelect: string | null = null
  /** Bumped by every user selection; a worktree reply selects only if no newer one happened since. */
  private selectIntent = 0
  /** Tasks whose worktree is being materialized, with the selection their reply may still apply. */
  private readonly provisioning = new Map<string, { intent: number; tabId: string | null }>()

  constructor(readonly client: BridgeClient) {
    client.onOpen(() => {
      void client.request<TasksPayload>("tasks.subscribe").then((payload) => this.acceptTasks(payload))
    })
    client.on("tasks", (data) => {
      if (isTasksPayload(data)) this.acceptTasks(data)
    })
    // Tab-only changes (a rename, a tab the TUI opened) leave the task rows alone, so no `tasks` push comes.
    client.on("tabs", () => this.scheduleTabRefresh())
  }

  select(taskId: string, tabId: string | null = null): void {
    const intent = ++this.selectIntent
    // As the TUI's `activateWorkspaceTask`: a task with no worktree yet is materialized first,
    // and selected only once that worked.
    if (this.tasks.get()?.tasks.find((task) => task.id === taskId)?.noWorktree) {
      if (this.provisioning.has(taskId)) this.provisioning.set(taskId, { intent, tabId })
      else void this.provisionThenSelect(taskId, { intent, tabId })
      return
    }
    this.commitSelection(taskId, tabId)
  }

  private commitSelection(taskId: string, tabId: string | null): void {
    const tabs = this.tabs.get()[taskId] ?? []
    const next = { taskId, tabId: tabId ?? preferredTab(tabs)?.id ?? null }
    this.selection.set(next)
    localStorage.setItem(SELECTION_KEY, JSON.stringify(next))
    const visits = [
      { ...next, at: Date.now() },
      ...this.visits.get().filter((v) => v.taskId !== next.taskId || v.tabId !== next.tabId),
    ].slice(0, VISITS_MAX)
    this.visits.set(visits)
    localStorage.setItem(VISITS_KEY, JSON.stringify(visits))
  }

  private async provisionThenSelect(taskId: string, request: { intent: number; tabId: string | null }): Promise<void> {
    this.provisioning.set(taskId, request)
    let ok = true
    try {
      await this.client.request("task.ensureWorktree", { taskId })
    } catch (err) {
      ok = false
      toast(err instanceof Error ? err.message : String(err), "error")
    }
    const latest = this.provisioning.get(taskId) ?? request
    this.provisioning.delete(taskId)
    if (!ok) return
    this.markProvisioned(taskId)
    const listed = this.tasks.get()?.tasks.some((task) => task.id === taskId) ?? false
    if (listed && latest.intent === this.selectIntent) this.commitSelection(taskId, latest.tabId)
  }

  /** The next `tasks` push carries the path; until then the row must not provision again. */
  private markProvisioned(taskId: string): void {
    const payload = this.tasks.get()
    if (!payload) return
    const tasks = payload.tasks.map((task) => (task.id === taskId ? { ...task, noWorktree: undefined } : task))
    this.tasks.set({ ...payload, tasks })
  }

  selectWhenListed(taskId: string): void {
    if (this.tasks.get()?.tasks.some((task) => task.id === taskId)) this.select(taskId)
    else this.pendingSelect = taskId
  }

  /** Where `s` and the PR chip deliver, like the TUI: the selected tab when it is an engine, else the bridge's default (first engine tab). */
  engineTarget(taskId: string): { taskId: string; tabId?: string } {
    const { taskId: selectedTask, tabId } = this.selection.get()
    const tab = selectedTask === taskId ? this.tabs.get()[taskId]?.find((row) => row.id === tabId) : undefined
    return tab?.kind === "engine" ? { taskId, tabId: tab.id } : { taskId }
  }

  /** After a tab was opened or closed here: don't wait for the next push. */
  async refreshTabsNow(): Promise<void> {
    await this.refreshTabs(this.tasks.get()?.tasks ?? [])
  }

  private acceptTasks(payload: TasksPayload): void {
    this.remote.set(payload.tasks.filter((task) => task.machine))
    this.tasks.set({ ...payload, tasks: payload.tasks.filter((task) => !task.machine) })
    if (this.pendingSelect && payload.tasks.some((task) => task.id === this.pendingSelect)) {
      this.select(this.pendingSelect)
      this.pendingSelect = null
    }
    this.scheduleTabRefresh()
  }

  private scheduleTabRefresh(): void {
    if (this.tabTimer !== null) return
    this.tabTimer = window.setTimeout(() => {
      this.tabTimer = null
      void this.refreshTabs(this.tasks.get()?.tasks ?? [])
    }, TAB_REFRESH_DEBOUNCE_MS)
  }

  private async refreshTabs(tasks: readonly TaskRow[]): Promise<void> {
    const sweep = ++this.tabSweep
    const live = tasks.filter((task) => !task.deleting)
    // Each reply lands on its own, so one slow task doesn't hold back the selected one's terminal.
    await Promise.all(
      live.map(async (task) => {
        let tabs: readonly TabRow[]
        try {
          tabs = (await this.client.request<{ tabs: TabRow[] }>("task.tabs", { taskId: task.id })).tabs
        } catch {
          return
        }
        if (sweep !== this.tabSweep) return
        this.tabs.set({ ...this.tabs.get(), [task.id]: tabs })
        this.reselectIfClosed(task.id)
      }),
    )
    if (sweep !== this.tabSweep) return
    const kept = new Set(live.map((task) => task.id))
    this.tabs.set(Object.fromEntries(Object.entries(this.tabs.get()).filter(([id]) => kept.has(id))))
  }

  /** A selected tab that closed falls back to the task's first live one, like the TUI. */
  private reselectIfClosed(taskId: string): void {
    const selected = this.selection.get()
    if (selected.taskId !== taskId) return
    const tabs = this.tabs.get()[taskId] ?? []
    if (!tabs.some((tab) => tab.id === selected.tabId)) this.commitSelection(taskId, null)
  }
}

/** The tab a bare task click opens: the first live one, else the first. */
function preferredTab(tabs: readonly TabRow[]): TabRow | undefined {
  return tabs.find((tab) => tab.alive !== false) ?? tabs[0]
}
