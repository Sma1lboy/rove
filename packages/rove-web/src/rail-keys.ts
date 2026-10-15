/**
 * The rail's keyboard layer: the TUI sidebar's own chords (`keybindings-sidebar.ts`,
 * `task.new`), active while the rail has focus. Row verbs run the same entries as
 * the right-click menu (`MenuItem.key`), so a key and its menu entry cannot differ.
 */

import type { KeyboardEvent } from "react"
import { useEffect, useRef, useState } from "react"
import { t } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { type NavRow, SORT_MODES, type SortMode } from "./rail.ts"
import { taskMenu } from "./row-actions.tsx"
import { page, toast } from "./ui.ts"

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
  const cycleSort = () => {
    const next = SORT_MODES[(SORT_MODES.indexOf(sort) + 1) % SORT_MODES.length] ?? "default"
    setSort(next)
    localStorage.setItem(SORT_KEY, next)
  }
  return { sort, cycleSort, search, setSearch }
}

export type RailFilters = ReturnType<typeof useRailFilters>

type Stop = Exclude<NavRow, { kind: "project" }>

export function useRailKeys(
  model: AppModel,
  allRows: readonly NavRow[],
  filters: RailFilters,
  opts: { onNewTask: (repo?: string) => void; onSettings: () => void; selectedId: string | null },
): { cursor: string | null; setCursor: (id: string) => void; onKeyDown: (e: KeyboardEvent) => void } {
  const { search, setSearch } = filters
  const [cursor, setCursor] = useState<string | null>(null)
  const gAt = useRef(0)
  // Project headers are not stops, as the TUI's `treeFlatIds`.
  const rows = allRows.filter((row): row is Stop => row.kind !== "project")

  // The cursor rests on the selection until the keys move it, and is re-homed when its row vanishes.
  const at = rows.findIndex((row) => row.id === cursor)
  useEffect(() => {
    if (at < 0)
      setCursor(opts.selectedId && rows.some((r) => r.id === opts.selectedId) ? opts.selectedId : (rows[0]?.id ?? null))
  }, [at, rows, opts.selectedId])
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
    if (row?.kind === "task") model.select(row.task.id)
    if (row?.kind === "tab") model.select(row.task.id, row.tab.id)
  }
  const verb = (row: Stop | undefined, key: string) => {
    if (!row) return
    taskMenu(model, row.task, null)
      .find((item) => item.key === key)
      ?.run()
  }
  const cycleEngine = async (row: Stop | undefined) => {
    if (!row) return
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
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const row = rows[at]
    if (search.active) {
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
    switch (e.key) {
      case "j":
      case "ArrowDown":
        move(at + 1)
        break
      case "k":
      case "ArrowUp":
        move(at - 1)
        break
      case "g":
        if (Date.now() - gAt.current < GG_MS) {
          move(0)
          gAt.current = 0
        } else gAt.current = Date.now()
        break
      case "G":
        move(rows.length - 1)
        break
      case "Enter":
      case "l":
      case " ":
        open(row)
        break
      case "ArrowRight":
        document.querySelector<HTMLElement>(".term-slot:not(.is-hidden) textarea")?.focus()
        break
      case "r":
      case "b":
      case "P":
      case "d":
        verb(row, e.key)
        break
      case "v":
        void cycleEngine(row)
        break
      case "t":
        filters.cycleSort()
        break
      case "/":
        setSearch({ active: true, query: "" })
        break
      case "n":
        opts.onNewTask(row?.task.repo)
        break
      case "s":
        opts.onSettings()
        break
      case "x":
        page.set("worktrees")
        break
      case "u":
        page.set("update")
        break
      default:
        return
    }
    e.preventDefault()
  }

  return { cursor, setCursor, onKeyDown }
}
