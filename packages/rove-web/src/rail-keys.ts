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
import { moveMode, moveRow } from "./move-mode.ts"
import { railCursorTask } from "./rail-aim.ts"
import { type NavRow, SORT_MODES, type SortMode } from "./rail.ts"
import { taskMenu } from "./row-actions.tsx"
import { findBinding, page, toast } from "./ui.ts"
import { keysOf } from "./user-keys.ts"

const SORT_KEY = "rove.activeSortMode"
/** Second `g` of `gg` must land within this. */
const GG_MS = 600

function loadSort(): SortMode {
  const saved = localStorage.getItem(SORT_KEY)
  return SORT_MODES.find((mode) => mode === saved) ?? "default"
}

/** Sort + `/` query: owned by the rail, which builds the rows from them before the keys see them. */
export function useRailFilters() {
  const [sort, setSort] = useState<SortMode>(loadSort)
  const [search, setSearch] = useState({ active: false, query: "" })
  // Open routine count rows (project repos); session-scoped, as the TUI's `expandedRoutines`.
  const [routines, setRoutines] = useState<ReadonlySet<string>>(new Set())
  const toggleRoutines = (repo: string) =>
    setRoutines((now) => {
      const next = new Set(now)
      if (!next.delete(repo)) next.add(repo)
      return next
    })
  const cycleSort = () => {
    const next = SORT_MODES[(SORT_MODES.indexOf(sort) + 1) % SORT_MODES.length] ?? "default"
    setSort(next)
    localStorage.setItem(SORT_KEY, next)
  }
  return { sort, cycleSort, search, setSearch, routines, toggleRoutines }
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
  const cursorTaskId = cursorRow && cursorRow.kind !== "routines" ? cursorRow.task.id : null
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
    if (row?.kind === "task") model.select(row.task.id)
    if (row?.kind === "tab") model.select(row.task.id, row.tab.id)
    if (row) enterWorkspace()
  }
  const verb = (row: Stop | undefined, id: RailId) => {
    if (!row || row.kind === "routines") return
    // A remote task's menu holds only what runs on its machine, so a key with no entry there does nothing.
    findBinding(taskMenu(model, row.task, null), id)?.run?.()
  }
  const cycleEngine = async (row: Stop | undefined) => {
    if (!row || row.kind === "routines" || row.machine !== undefined) return
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
      const movable = row && row.kind !== "routines" && row.machine === undefined
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
        if (row?.machine === undefined) moveMode.set(true)
        break
      case "sidebar.sort":
        filters.cycleSort()
        break
      case "sidebar.search.enter":
        setSearch({ active: true, query: "" })
        break
      case "task.new":
        // On another machine's row the dialog opens on that machine, with that row's repo.
        opts.onNewTask(row?.kind === "routines" ? row.repo : row?.task.repo, row?.machine)
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
