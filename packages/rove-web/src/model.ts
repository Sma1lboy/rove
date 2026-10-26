/**
 * What the page knows: the task feed (`tasks.subscribe` + `tasks` pushes), the
 * tabs of every task (the rail lists them all, like the TUI's always-expanded
 * tree), and which task/tab is open. Selection survives a reload, and what is
 * open is reported to the daemon (`ui.viewing`), which decides every row's status.
 */

import { type ModPaneView, parseModUiPayload } from "@sma1lboy/rove/src/tui/panes/mods/mods-core.ts"
import type { DispatchSnapshot, TabRow, TaskRow, TasksPayload } from "rove-bridge/protocol"
import type { BridgeClient } from "./bridge.ts"
import { type Store, createStore } from "./store.ts"
import { toast } from "./ui.ts"

export interface Selection {
  readonly taskId: string | null
  readonly tabId: string | null
}

const SELECTION_KEY = "rove.web.selection"
/** `ui.viewing`'s key for "shows no task". */
const NOTHING_SHOWN = "null"
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

/** The selected task's row: a listed one, else an archived one opened from the rail's Archived fold. */
export function selectedRow(payload: TasksPayload | null, taskId: string | null): TaskRow | undefined {
  if (!taskId) return undefined
  return payload?.tasks.find((row) => row.id === taskId) ?? payload?.archived?.find((row) => row.id === taskId)
}

export class AppModel {
  /** This Mac's rows only: every action and page reads these, so nothing aims a verb at another machine's task. */
  readonly tasks: Store<TasksPayload | null> = createStore<TasksPayload | null>(null)
  /** Other registered machines' rows (`machine` set): listed under their header, read-only, as the TUI. */
  readonly remote: Store<readonly TaskRow[]> = createStore<readonly TaskRow[]>([])
  readonly tabs: Store<Readonly<Record<string, readonly TabRow[]>>> = createStore({})
  /** The first tab sweep has answered (or failed) for every task: an absent entry now means a failed read, not one still on its way. */
  readonly tabsSettled: Store<boolean> = createStore(false)
  /** Every open mod pane, re-validated from the `mods` push (the bridge sends it on connect). */
  readonly mods: Store<readonly ModPaneView[]> = createStore<readonly ModPaneView[]>([])
  /** The daemon's dispatch ledger, as the bridge last pushed it; null until it does (or the daemon has none). */
  readonly dispatches: Store<DispatchSnapshot | null> = createStore<DispatchSnapshot | null>(null)
  /** First-party mods (Kanban, Issues) installed on this machine; none until `builtinMods.list` answers. */
  readonly installedMods: Store<ReadonlySet<string>> = createStore<ReadonlySet<string>>(new Set())
  readonly selection: Store<Selection> = createStore(loadSelection())
  /** Newest first; the Inbox's RECENT section (the TUI keeps its own the same way, per client). */
  readonly visits: Store<readonly Visit[]> = createStore(loadVisits())
  private tabTimer: number | null = null
  private tabsLoaded = false
  /** Bumped per sweep; a sweep resolving after a newer one started commits nothing. */
  private tabSweep = 0
  /** A task just created here: select it once the feed lists it. */
  private pendingSelect: string | null = null
  /** Bumped by every user selection; a worktree reply selects only if no newer one happened since. */
  private selectIntent = 0
  /** Tasks whose worktree is being materialized, with the selection their reply may still apply. */
  private readonly provisioning = new Map<string, { intent: number; tabId: string | null }>()
  /** What this socket last reported as shown (`ui.viewing`); a fresh socket has reported nothing. */
  private viewingSent = NOTHING_SHOWN
  private taskShown = true
  /** The page's side-panel layout, sent beside the task in every report (`panel-report.ts` fills it in). */
  viewingExtras: () => Readonly<Record<string, boolean>> = () => ({})

  constructor(readonly client: BridgeClient) {
    client.onOpen(() => {
      void client.request<TasksPayload>("tasks.subscribe").then((payload) => this.acceptTasks(payload))
      // The bridge forgot what a closed socket showed.
      this.viewingSent = NOTHING_SHOWN
      this.reportViewing()
      void this.refreshMods()
    })
    // A hidden page shows nothing: its finished turns stay unseen until someone looks.
    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      document.addEventListener("visibilitychange", () => {
        this.reportViewing()
        // A mod installed from the TUI or the CLI meanwhile shows when the page is looked at again.
        if (document.visibilityState === "visible") void this.refreshMods()
      })
    }
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("pagehide", () => this.reportViewing(true))
    }
    client.on("tasks", (data) => {
      if (isTasksPayload(data)) this.acceptTasks(data)
    })
    // Tab-only changes (a rename, a tab the TUI opened) leave the task rows alone, so no `tasks` push comes.
    client.on("tabs", () => this.scheduleTabRefresh())
    client.on("mods", (data) => this.mods.set(parseModUiPayload(data) ?? []))
    client.on("dispatch", (data) => {
      if (data && typeof data === "object" && "rows" in data && Array.isArray(data.rows)) {
        this.dispatches.set(data as DispatchSnapshot)
      }
    })
  }

  async refreshMods(): Promise<void> {
    try {
      const { mods } = await this.client.request<{ mods: { id: string; installed: boolean }[] }>("builtinMods.list")
      this.installedMods.set(new Set(mods.filter((mod) => mod.installed).map((mod) => mod.id)))
    } catch {
      // A bridge without the op predates first-party mods: keep what we had.
    }
  }

  /** Called on every explicit pick (not a closed tab's fallback): a phone turns from its list to the task. */
  onSelect: () => void = () => {}

  /** False while the task panel is out of sight (a phone on its list): nothing counts as looked at. */
  setTaskShown(shown: boolean): void {
    if (this.taskShown === shown) return
    this.taskShown = shown
    this.reportViewing()
  }

  select(taskId: string, tabId: string | null = null): void {
    this.onSelect()
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
    this.reportViewing()
    // An archived task's tabs are read only once it is open (`tabbedTasks`).
    if (!(taskId in this.tabs.get())) this.scheduleTabRefresh()
  }

  /**
   * Tell the daemon what this page shows (`ui.viewing`): the selected task and tab while the page
   * is visible, nothing once it is hidden or leaving, plus how its side panel is laid out
   * (`viewingExtras`). A tab being looked at never shows unseen. A change of the layout alone reports again.
   */
  reportViewing(leaving = false): void {
    const { taskId, tabId } = this.selection.get()
    const hidden = leaving || (typeof document !== "undefined" && document.visibilityState === "hidden")
    const shown =
      hidden || !taskId || !this.taskShown ? null : { taskId, ...(tabId ? { tabId } : {}), ...this.viewingExtras() }
    const key = JSON.stringify(shown)
    if (key === this.viewingSent) return
    this.viewingSent = key
    void this.client.request("ui.viewing", shown ?? { taskId: null }).catch(() => {
      // Not connected: the next open reports again.
      if (this.viewingSent === key) this.viewingSent = NOTHING_SHOWN
    })
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
    await this.refreshTabs(this.tabbedTasks())
  }

  /** Every task whose tabs can be read: this machine's, and those of the other machines that answer. */
  private tabbedTasks(): readonly TaskRow[] {
    const payload = this.tasks.get()
    // Of the archived tasks only the open one: the fold lists them without reading every tab list.
    const open = payload?.archived?.find((task) => task.id === this.selection.get().taskId)
    return [
      ...(payload?.tasks ?? []),
      ...(open ? [open] : []),
      ...this.remote.get().filter((task) => !task.machine?.stale),
    ]
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
    // The first load reads tabs at once; the debounce only batches later pushes.
    const delay = this.tabsLoaded ? TAB_REFRESH_DEBOUNCE_MS : 0
    this.tabsLoaded = true
    this.tabTimer = window.setTimeout(() => {
      this.tabTimer = null
      void this.refreshTabs(this.tabbedTasks())
    }, delay)
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
    if (!this.tabsSettled.get()) this.tabsSettled.set(true)
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
