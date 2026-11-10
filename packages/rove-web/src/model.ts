/**
 * What the page knows: the task feed (`tasks.subscribe` + `tasks` pushes), the
 * tabs of every task (the rail lists them all, like the TUI's always-expanded
 * tree), and which task/tab is open. Selection survives a reload, and what is
 * open is reported to the daemon (`ui.viewing`), which decides every row's status.
 */

import { type ModPaneView, parseModUiPayload } from "@sma1lboy/rove/src/tui/panes/mods/mods-core.ts"
import type { TabRow, TaskRow, TasksPayload } from "rove-bridge/protocol"
import type { BridgeClient } from "./bridge.ts"
import { type TasksEdit, taskEdit } from "./optimistic.ts"
import { type Store, createStore } from "./store.ts"
import { toast } from "./ui.ts"

export interface Selection {
  readonly taskId: string | null
  readonly tabId: string | null
}

const SELECTION_KEY = "rove.web.selection"
/** `ui.viewing`'s key for "shows no task". */
const NOTHING_SHOWN = "null"
/** The least time between two sweeps of tab reads; a lone change does not wait for it. */
const TAB_READ_GAP_MS = 300

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

/** The `tabs` push names the tasks whose tab list changed. */
function changedTaskIds(data: unknown): readonly string[] | undefined {
  if (!data || typeof data !== "object" || !("taskIds" in data)) return undefined
  const ids = (data as { taskIds?: unknown }).taskIds
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : undefined
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

/**
 * Where the selection goes once the open task stops being live (archived, being deleted, gone),
 * as the TUI moves off a deleting task: the latest visit that is still live, else no task.
 * Null = stay put. Only the change counts, so an archived task opened from the fold stays open.
 */
export function selectionAfterLeave(
  before: readonly TaskRow[],
  after: readonly TaskRow[],
  selected: Selection,
  visits: readonly Visit[],
): Selection | null {
  const live = (rows: readonly TaskRow[], id: string) => rows.some((task) => task.id === id && !task.deleting)
  const id = selected.taskId
  if (id === null || !live(before, id) || live(after, id)) return null
  const back = visits.find((visit) => visit.taskId !== id && live(after, visit.taskId))
  return back ? { taskId: back.taskId, tabId: back.tabId } : { taskId: null, tabId: null }
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
  /** First-party mods (Kanban, Issues) installed on this machine; none until `builtinMods.list` answers. */
  readonly installedMods: Store<ReadonlySet<string>> = createStore<ReadonlySet<string>>(new Set())
  readonly selection: Store<Selection> = createStore(loadSelection())
  /** Newest first; the Inbox's RECENT section (the TUI keeps its own the same way, per client). */
  readonly visits: Store<readonly Visit[]> = createStore(loadVisits())
  private tabTimer: number | null = null
  private tabsReadAt = Number.NEGATIVE_INFINITY
  /** The tasks whose tabs the next read covers; null = every task. */
  private tabScope: Set<string> | null = new Set()
  /** The tab ids the daemon last reported per task, as one string: a change is what re-reads that task's tabs. */
  private readonly tabSets = new Map<string, string>()
  /** The latest `task.tabs` read per task; an older reply is dropped. */
  private readonly tabReads = new Map<string, number>()
  /** The daemon's last list, before this page's own edits. */
  private served: TasksPayload | null = null
  /** Edits drawn ahead of the daemon; true once its request succeeded, so the next push replaces it. */
  private readonly edits = new Map<TasksEdit, boolean>()
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
    client.on("tabs", (data) => this.scheduleTabRefresh(changedTaskIds(data)))
    client.on("mods", (data) => this.mods.set(parseModUiPayload(data) ?? []))
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
    if (!(taskId in this.tabs.get())) this.scheduleTabRefresh([taskId])
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

  /** After a tab of `taskId` was opened, closed or renamed here: don't wait for the next push. */
  async refreshTabsNow(taskId: string): Promise<void> {
    await this.refreshTabs([taskId])
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

  /**
   * Send an op that changes the task list. One that `optimistic.ts` can predict is drawn on the
   * click; every such op is sent from here, so none waits a round trip to show.
   */
  act<T = unknown>(op: string, args: Readonly<Record<string, unknown>>): Promise<T> {
    const edit = taskEdit(op, args)
    const send = () => this.client.request<T>(op, args)
    return edit ? this.optimistic(edit, send) : send()
  }

  /** The tab leaves the strip on the click; the daemon's own list follows, and puts it back if the close failed. */
  closeTab(taskId: string, tabId: string): Promise<void> {
    return this.tabAct(taskId, "tab.close", { taskId, tabId }, (tabs) => tabs.filter((tab) => tab.id !== tabId))
  }

  renameTab(taskId: string, tabId: string, title: string): Promise<void> {
    return this.tabAct(taskId, "tab.rename", { taskId, tabId, title }, (tabs) =>
      tabs.map((tab) => (tab.id === tabId ? { ...tab, title } : tab)),
    )
  }

  private async tabAct(
    taskId: string,
    op: string,
    args: Readonly<Record<string, unknown>>,
    edit: (tabs: readonly TabRow[]) => readonly TabRow[],
  ): Promise<void> {
    const shown = this.tabs.get()[taskId]
    if (shown) {
      // A read already on its way predates the edit: drop its reply.
      this.tabReads.set(taskId, (this.tabReads.get(taskId) ?? 0) + 1)
      this.tabs.set({ ...this.tabs.get(), [taskId]: edit(shown) })
      this.reselectIfClosed(taskId)
    }
    try {
      await this.client.request(op, args)
    } finally {
      await this.refreshTabs([taskId])
    }
  }

  /**
   * Draw `edit` now and send `request`. A failure puts the daemon's list back. A success keeps the
   * edit until the next push, which carries the same change.
   */
  async optimistic<T>(edit: TasksEdit, request: () => Promise<T>): Promise<T> {
    this.edits.set(edit, false)
    const open = this.selection.get()
    if (this.served) this.acceptTasks(this.served, true)
    try {
      const result = await request()
      // ponytail: a push read before the daemon applied the change undoes the edit until the next one; track a revision if that flicker shows.
      if (this.edits.has(edit)) this.edits.set(edit, true)
      return result
    } catch (err) {
      this.edits.delete(edit)
      if (this.served) this.acceptTasks(this.served, true)
      // The edit moved the selection off a row that never left.
      const back = open.taskId !== null && this.selection.get().taskId !== open.taskId
      if (back && selectedRow(this.tasks.get(), open.taskId)) this.commitSelection(open.taskId as string, open.tabId)
      throw err
    }
  }

  private acceptTasks(served: TasksPayload, redraw = false): void {
    this.served = served
    let payload = served
    for (const [edit, confirmed] of this.edits) {
      if (confirmed && !redraw) this.edits.delete(edit)
      else payload = edit(payload)
    }
    const before = [...(this.tasks.get()?.tasks ?? []), ...this.remote.get()]
    this.remote.set(payload.tasks.filter((task) => task.machine))
    this.tasks.set({ ...payload, tasks: payload.tasks.filter((task) => !task.machine) })
    const left = selectionAfterLeave(before, payload.tasks, this.selection.get(), this.visits.get())
    if (left?.taskId) this.commitSelection(left.taskId, left.tabId)
    else if (left) {
      this.selection.set(left)
      localStorage.setItem(SELECTION_KEY, JSON.stringify(left))
      this.reportViewing()
    }
    if (this.pendingSelect && payload.tasks.some((task) => task.id === this.pendingSelect)) {
      this.select(this.pendingSelect)
      this.pendingSelect = null
    }
    const listed = this.tabbedTasks()
    const kept = new Set(listed.map((task) => task.id))
    const known = this.tabs.get()
    if (Object.keys(known).some((id) => !kept.has(id))) {
      this.tabs.set(Object.fromEntries(Object.entries(known).filter(([id]) => kept.has(id))))
    }
    for (const id of this.tabSets.keys()) if (!kept.has(id)) this.tabSets.delete(id)
    // A push comes for every token count; tabs are read again only where the daemon's set of tabs changed.
    const changed = listed.filter((task) => {
      const set = Object.keys(task.tabStatus ?? {})
        .sort()
        .join(" ")
      if (this.tabSets.get(task.id) === set) return false
      this.tabSets.set(task.id, set)
      return true
    })
    if (changed.length > 0) this.scheduleTabRefresh(changed.map((task) => task.id))
  }

  /** `taskIds` names the tasks to read; without it (a bridge that names none) every task is read. */
  private scheduleTabRefresh(taskIds?: readonly string[]): void {
    if (!taskIds) this.tabScope = null
    else for (const id of taskIds) this.tabScope?.add(id)
    if (this.tabTimer !== null) return
    // A change with no read just before it is read at once; the gap only batches a run of them.
    const delay = Math.max(0, this.tabsReadAt + TAB_READ_GAP_MS - Date.now())
    this.tabTimer = window.setTimeout(() => {
      this.tabTimer = null
      this.tabsReadAt = Date.now()
      const scope = this.tabScope
      this.tabScope = new Set()
      void this.refreshTabs(scope ? [...scope] : this.tabbedTasks().map((task) => task.id))
    }, delay)
  }

  private async refreshTabs(taskIds: readonly string[]): Promise<void> {
    // Each reply lands on its own, so one slow task doesn't hold back the selected one's terminal.
    await Promise.all(
      taskIds.map(async (taskId) => {
        const read = (this.tabReads.get(taskId) ?? 0) + 1
        this.tabReads.set(taskId, read)
        let tabs: readonly TabRow[]
        try {
          tabs = (await this.client.request<{ tabs: TabRow[] }>("task.tabs", { taskId })).tabs
        } catch {
          return
        }
        // A newer read of this task is on its way, or already landed.
        if (this.tabReads.get(taskId) !== read) return
        this.tabs.set({ ...this.tabs.get(), [taskId]: tabs })
        this.reselectIfClosed(taskId)
      }),
    )
    if (!this.tabsSettled.get()) this.tabsSettled.set(true)
  }

  private reselectIfClosed(taskId: string): void {
    const selected = this.selection.get()
    if (selected.taskId !== taskId) return
    const tabs = this.tabs.get()[taskId] ?? []
    if (!tabs.some((tab) => tab.id === selected.tabId)) this.commitSelection(taskId, null)
  }
}

/** The tab a bare task click opens: the first live one, else the first. */
export function preferredTab(tabs: readonly TabRow[]): TabRow | undefined {
  return tabs.find((tab) => tab.alive !== false) ?? tabs[0]
}
