/**
 * The rail's keyboard layer: the TUI sidebar's own chords (`keybindings-sidebar.ts`,
 * `task.new`), active while the rail has focus. Row verbs run the same entries as
 * the right-click menu (`MenuItem.key`), so a key and its menu entry cannot differ.
 */

import type { KeyboardEvent } from "react"
import { useEffect, useRef, useState } from "react"
import { chordCandidates } from "./chord.ts"
import { t } from "./i18n/index.ts"
import { enterWorkspace } from "./layout.ts"
import type { AppModel } from "./model.ts"
import { moveMode, moveRow, setMoveMode } from "./move-mode.ts"
import { railCursorTask } from "./rail-aim.ts"
import { cycleRailSort, railSort } from "./rail-sort.ts"
import type { NavRow } from "./rail.ts"
import { taskMenu } from "./row-actions.tsx"
import { useStore } from "./store.ts"
import { tc } from "./tui-copy.ts"
import { findBinding, page, toast } from "./ui.ts"
import { keysOf } from "./user-keys.ts"

const COLLAPSED_KEY = "rove.collapsedProjects"
const FOLDED_TASKS_KEY = "rove.foldedTasks"
const OPENED_TASKS_KEY = "rove.openedTasks"
/** Second `g` of `gg` must land within this. */
const GG_MS = 600

function loadSet(key: string): ReadonlySet<string> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) ?? "[]")
    return new Set(Array.isArray(saved) ? saved.filter((id): id is string => typeof id === "string") : [])
  } catch {
    return new Set()
  }
}

function saveSet(key: string, ids: ReadonlySet<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...ids]))
  } catch {
    // Storage off: the fold lasts this page only.
  }
}

const toggled = (now: ReadonlySet<string>, id: string): ReadonlySet<string> => {
  const next = new Set(now)
  if (!next.delete(id)) next.add(id)
  return next
}

/** Sort + `/` query: owned by the rail, which builds the rows from them before the keys see them. */
export function useRailFilters() {
  const sort = useStore(railSort)
  const [search, setSearch] = useState({ active: false, query: "" })
  // Open routine count rows (project repos); session-scoped, as the TUI's `expandedRoutines`.
  const [routines, setRoutines] = useState<ReadonlySet<string>>(new Set())
  const toggleRoutines = (repo: string) => setRoutines((now) => toggled(now, repo))
  // The Archived fold at the end; session-scoped like the routine rows.
  const [archivedOpen, setArchivedOpen] = useState(false)
  const toggleArchived = () => setArchivedOpen((open) => !open)
  // Collapsed project headers (row ids); kept per browser, as Claude's sidebar sections.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => loadSet(COLLAPSED_KEY))
  const toggleProject = (id: string) =>
    setCollapsed((now) => {
      const next = toggled(now, id)
      saveSet(COLLAPSED_KEY, next)
      return next
    })
  // Parents folded or opened by hand (ids); per browser too. Past that, a crowded parent folds on its own.
  const [hand, setHand] = useState(() => ({
    folded: loadSet(FOLDED_TASKS_KEY),
    opened: loadSet(OPENED_TASKS_KEY),
  }))
  const toggleTaskFold = (id: string, collapsed: boolean) =>
    setHand((now) => {
      const folded = new Set(now.folded)
      const opened = new Set(now.opened)
      if (collapsed) {
        folded.delete(id)
        opened.add(id)
      } else {
        opened.delete(id)
        folded.add(id)
      }
      saveSet(FOLDED_TASKS_KEY, folded)
      saveSet(OPENED_TASKS_KEY, opened)
      return { folded, opened }
    })
  return {
    sort,
    cycleSort: cycleRailSort,
    search,
    setSearch,
    routines,
    toggleRoutines,
    archivedOpen,
    toggleArchived,
    collapsed,
    toggleProject,
    hand,
    toggleTaskFold,
  }
}

export type RailFilters = ReturnType<typeof useRailFilters>

type Stop = Exclude<NavRow, { kind: "project" }>

/** The TUI binding ids the rail answers to (`keybindings-sidebar.ts`, `task.new`, Settings, Worktrees). */
const RAIL_IDS = [
  "sidebar.nav",
  "sidebar.goto",
  "sidebar.select",
  "sidebar.tree.open",
  "sidebar.rename",
  "sidebar.pin",
  "sidebar.localMerge",
  "sidebar.delete",
  "sidebar.sort",
  "sidebar.search.enter",
  "tasks.renameBranch",
  "tasks.cycleEngine",
  "tasks.openWorktree",
  "tasks.update",
  "tasks.focusEngine",
  "task.new",
  "settings.open.sidebar",
  "worktrees.open.sidebar",
] as const

type RailId = (typeof RAIL_IDS)[number]

/** The rail binding a key press is, by the live keymap (the user's chords included); `slot` is the chord's place in the row's `keys`. */
function railAction(candidates: readonly string[]): { id: RailId; slot: number } | null {
  for (const candidate of candidates) {
    for (const id of RAIL_IDS) {
      const slot = keysOf(id).indexOf(candidate)
      if (slot >= 0) return { id, slot }
    }
  }
  return null
}

export function useRailKeys(
  model: AppModel,
  allRows: readonly NavRow[],
  filters: RailFilters,
  opts: { onNewTask: (repo?: string, machine?: string) => void; onSettings: () => void; selectedId: string | null },
): { cursor: string | null; setCursor: (id: string) => void; onKeyDown: (e: KeyboardEvent) => void } {
  const { search, setSearch } = filters
  const [cursor, setCursor] = useState<string | null>(null)
  const gAt = useRef(0)
  // Project and machine headers are not stops, as the TUI's `treeFlatIds`.
  const rows = allRows.filter((row): row is Stop => row.kind !== "project")

  // The cursor rests on the selection until the keys move it, and is re-homed when its row vanishes.
  const at = rows.findIndex((row) => row.id === cursor)
  useEffect(() => {
    if (at < 0)
      setCursor(opts.selectedId && rows.some((r) => r.id === opts.selectedId) ? opts.selectedId : (rows[0]?.id ?? null))
  }, [at, rows, opts.selectedId])
  const cursorRow = rows[at]
  const cursorTaskId = cursorRow?.kind === "task" ? cursorRow.task.id : null
  useEffect(() => railCursorTask.set(cursorTaskId), [cursorTaskId])
  // Top match on every search keystroke, as the TUI.
  const firstId = rows[0]?.id ?? null
  useEffect(() => {
    void search.query
    if (search.active) setCursor(firstId)
  }, [search.active, search.query, firstId])

  const move = (to: number) => {
    const row = rows[Math.max(0, Math.min(rows.length - 1, to))]
    if (row) setCursor(row.id)
  }
  const open = (row: Stop | undefined) => {
    if (row?.kind === "routines") filters.toggleRoutines(row.key)
    if (row?.kind === "archived") filters.toggleArchived()
    if (row?.kind === "task") model.select(row.task.id)
    if (row && row.kind !== "archived") enterWorkspace()
  }
  const verb = (row: Stop | undefined, id: RailId) => {
    if (row?.kind !== "task") return
    // A remote task's menu holds only what runs on its machine, so a key with no entry there does nothing.
    findBinding(taskMenu(model, row.task, null), id)?.run?.()
  }
  const cycleEngine = async (row: Stop | undefined) => {
    if (row?.kind !== "task" || row.machine !== undefined) return
    try {
      const { engines } = await model.client.request<{ engines: Array<{ id: string; name: string; ready?: boolean }> }>(
        "engines.list",
      )
      const usable = engines.filter((e) => e.ready !== false)
      const i = usable.findIndex((e) => e.id === row.task.engine?.id)
      const next = usable[(i + 1) % usable.length]
      if (!next || next.id === row.task.engine?.id) return
      await model.client.request("task.setCommand", { taskId: row.task.id, engine: next.id })
      toast(t("rail.engineSwitched", { engine: next.name }))
    } catch (e) {
      toast(t("rail.engineSwitchFailed", { error: e instanceof Error ? e.message : String(e) }), "error")
    }
  }

  const onKeyDown = (e: KeyboardEvent) => {
    const row = rows[at]
    if (search.active) {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === "Escape") setSearch({ active: false, query: "" })
      else if (e.key === "Enter") {
        open(row)
        setSearch({ active: false, query: "" })
      } else if (e.key === "ArrowDown") move(at + 1)
      else if (e.key === "ArrowUp") move(at - 1)
      else if (e.key === "Backspace") setSearch((s) => ({ ...s, query: s.query.slice(0, -1) }))
      else if (e.key.length === 1) setSearch((s) => ({ ...s, query: s.query + e.key }))
      else return
      e.preventDefault()
      return
    }
    const hit = railAction(chordCandidates(e))
    if (moveMode.get()) {
      // Only the move keys answer; `sidebar.*` verbs are off while a row is being dragged.
      const movable = row?.kind === "task" && row.machine === undefined
      if (hit?.id === "sidebar.nav") {
        if (movable) void moveRow(model, row, hit.slot % 2 === 0 ? 1 : -1)
      } else if (hit?.id === "sidebar.localMerge" || e.key === "Enter" || e.key === "Escape") moveMode.set(false)
      else return
      e.preventDefault()
      return
    }
    switch (hit?.id) {
      case "sidebar.nav":
        move(hit.slot % 2 === 0 ? at + 1 : at - 1)
        break
      case "sidebar.goto":
        if (hit.slot % 2 === 1) move(rows.length - 1)
        else if (Date.now() - gAt.current < GG_MS) {
          move(0)
          gAt.current = 0
        } else gAt.current = Date.now()
        break
      case "sidebar.select":
      case "sidebar.tree.open":
        open(row)
        break
      case "tasks.focusEngine":
        document.querySelector<HTMLElement>(".term-slot:not(.is-hidden) textarea")?.focus()
        break
      case "sidebar.rename":
      case "sidebar.pin":
      case "sidebar.delete":
      case "tasks.renameBranch":
      case "tasks.openWorktree":
        verb(row, hit.id)
        break
      case "tasks.cycleEngine":
        void cycleEngine(row)
        break
      case "sidebar.localMerge":
        if (row?.machine === undefined) setMoveMode(true)
        break
      case "sidebar.sort":
        filters.cycleSort()
        // The rail shows no sort label: the key says where it landed.
        toast(tc("tasks", "sort.label", { mode: tc("tasks", `sort.modes.${railSort.get()}`) }))
        break
      case "sidebar.search.enter":
        setSearch({ active: true, query: "" })
        break
      case "task.new":
        // On another machine's row the dialog opens on that machine, with that row's repo.
        opts.onNewTask(
          row?.kind === "routines" ? row.repo : row?.kind === "task" ? row.task.repo : undefined,
          row?.machine,
        )
        break
      case "settings.open.sidebar":
        opts.onSettings()
        break
      case "worktrees.open.sidebar":
        page.set("worktrees")
        break
      case "tasks.update":
        page.set("update")
        break
      default:
        return
    }
    e.preventDefault()
  }

  return { cursor, setCursor, onKeyDown }
}
