/**
 * Drag to reorder: a project header among projects, a task among its project's tasks (same pin),
 * as the TUI's move mode does with keys. While dragging, the rows slide to where the drop would leave
 * them; there is no insertion line. They slide by transform, not by reordering the DOM: Chrome
 * cancels a drag whose source node moves. Any sort drags; a drop outside manual order lands in
 * manual order and the rail switches to it, the only sort that shows where the row went.
 */

import type { CSSProperties, DragEvent, HTMLAttributes } from "react"
import { useEffect, useRef, useState } from "react"
import type { TaskRow } from "rove-bridge/protocol"
import type { AppModel } from "./model.ts"
import { moveTaskBy } from "./move-mode.ts"
import { type DropSide, blockEnd, dragSteps, dropSteps, previewDrop } from "./rail-blocks.ts"
import { setRailSort } from "./rail-sort.ts"
import type { NavRow } from "./rail.ts"
import { tc } from "./tui-copy.ts"
import { toast } from "./ui.ts"

export type DragProps = Pick<HTMLAttributes<HTMLElement>, "draggable" | "onDragStart" | "onDragEnd">

export interface RowPlace {
  readonly "data-row": string
  readonly style?: CSSProperties
}

interface Drag {
  readonly fromRow: string
  readonly from: TaskRow
  readonly toRow: string
  readonly to: TaskRow
  readonly side: DropSide
}

export function useRowDrag(
  model: AppModel,
  tasks: readonly TaskRow[],
  enabled: boolean,
  /** The rail shows manual order (the `default` sort). */
  manual: boolean,
  mainTaskOf: (repo: string) => { mainTaskId: string | null },
) {
  const [drag, setDrag] = useState<Drag | null>(null)
  const latest = useRef(tasks)
  latest.current = tasks
  // After a drop: the task list on screen when the last move returned. The preview holds until a newer one arrives.
  const [landing, setLanding] = useState<readonly TaskRow[] | null>(null)
  useEffect(() => {
    if (!landing) return
    const done = () => {
      setLanding(null)
      setDrag(null)
    }
    if (tasks !== landing) return done()
    const timer = window.setTimeout(done, 3000)
    return () => window.clearTimeout(timer)
  }, [tasks, landing])
  // The first dragover can arrive before the dragstart's render, so the handlers read refs.
  const live = useRef<Drag | null>(null)
  const shown = useRef<readonly NavRow[]>([])
  // Each row's top, the gap above it and its height, measured as the drag starts.
  const slots = useRef(new Map<string, { top: number; gap: number; height: number }>())
  // The dragged row with the rows under it, in px.
  const blockHeight = useRef(0)
  const lastY = useRef(0)
  const set = (next: Drag | null) => {
    live.current = next
    setDrag(next)
  }
  const taskOf = (row: NavRow): TaskRow | null => {
    if (!enabled || row.machine !== undefined) return null
    if (row.kind === "project") return tasks.find((task) => task.id === mainTaskOf(row.repo).mainTaskId) ?? null
    // Only top-level tasks move: a child's place is under its parent, and the daemon orders the flat list.
    return row.kind === "task" && row.depth === 1 && row.task.kind !== "main" ? row.task : null
  }
  const props = (row: NavRow): DragProps | undefined => {
    const task = taskOf(row)
    if (!task) return undefined
    return {
      draggable: true,
      onDragStart: (e: DragEvent) => {
        e.dataTransfer.effectAllowed = "move"
        e.dataTransfer.setData("text/plain", task.id)
        measure(e.currentTarget.closest(".rail-body"))
        const rows = shown.current
        const from = rows.findIndex((r) => r.id === row.id)
        blockHeight.current = rows
          .slice(from, blockEnd(rows, from))
          .reduce(
            (h, r, i) => h + (slots.current.get(r.id)?.height ?? 0) + (i > 0 ? (slots.current.get(r.id)?.gap ?? 0) : 0),
            0,
          )
        lastY.current = e.clientY
        set({ fromRow: row.id, from: task, toRow: row.id, to: task, side: "above" })
      },
      // A drop already let go of `live` and keeps its preview; this is the cancelled drag.
      onDragEnd: () => live.current && set(null),
    }
  }
  // The row a drag over `rows[i]` aims at: for a project, the project that row is in (its header,
  // standing for its main task); for a task, that task.
  const targetAt = (rows: readonly NavRow[], i: number, now: Drag): { row: string; task: TaskRow } | null => {
    let at = i
    if (now.from.kind === "main") while (at > 0 && rows[at]?.kind !== "project") at--
    const row = rows[at]
    const task = row && taskOf(row)
    if (!row || !task || dragSteps(tasks, now.from, task) === null) return null
    return { row: row.id, task }
  }
  // Letting go anywhere in the rail lands the row where the preview shows it.
  const body = {
    onDragOver: (e: DragEvent) => {
      const now = live.current
      if (!now) return
      e.preventDefault()
      const dy = e.clientY - lastY.current
      lastY.current = e.clientY
      const id = (e.target as Element).closest<HTMLElement>("[data-row]")?.dataset.row
      const rows = shown.current
      const hit = targetAt(
        rows,
        rows.findIndex((r) => r.id === id),
        now,
      )
      if (!hit || hit.row === now.fromRow) return
      // Over the dragged block (drawn where it would land) nothing changes; above or below it picks the side.
      const top = e.currentTarget.querySelector(`[data-row="${CSS.escape(now.fromRow)}"]`)?.getBoundingClientRect().top
      if (top === undefined || (e.clientY >= top && e.clientY < top + blockHeight.current)) return
      const side: DropSide = e.clientY < top ? "above" : "below"
      // Only a pointer moving that way moves the row: when a shorter block jumps past a still pointer,
      // the pointer lands on the far side without moving, and that must not send the block back.
      if (side === "above" ? dy >= 0 : dy <= 0) return
      if (now.toRow !== hit.row || now.side !== side) set({ ...now, toRow: hit.row, to: hit.task, side })
    },
    onDrop: (e: DragEvent) => {
      const now = live.current
      if (!now) return
      e.preventDefault()
      const steps = dropSteps(tasks, now.from, now.to, now.side)
      live.current = null
      if (!manual) {
        // The rows reorder under the new sort, so the preview has nothing to hold.
        setDrag(null)
        setRailSort("default")
        toast(tc("tasks", "sort.label", { mode: tc("tasks", "sort.modes.default") }))
        if (steps) void moveTaskBy(model, now.from.id, steps)
        return
      }
      // The preview stays until the daemon's new order has arrived, so the row doesn't jump back first.
      if (steps) void moveTaskBy(model, now.from.id, steps).finally(() => setLanding(latest.current))
      else setDrag(null)
    },
  }
  const measure = (body: Element | null) => {
    const els = [...(body?.querySelectorAll<HTMLElement>("[data-row]") ?? [])]
    slots.current = new Map(
      els.map((el, i) => {
        const prev = els[i - 1]
        // A group's gap belongs to the header after it, so it travels with that header.
        const gap = prev ? el.offsetTop - prev.offsetTop - prev.offsetHeight : 0
        return [el.dataset.row ?? "", { top: el.offsetTop, gap, height: el.offsetHeight }]
      }),
    )
  }
  // Each row's shift from where it is drawn to where the drop would leave it.
  const shifts = (rows: readonly NavRow[]): ReadonlyMap<string, number> => {
    shown.current = drag ? previewDrop(rows, drag.fromRow, drag.toRow, drag.side) : rows
    const out = new Map<string, number>()
    if (!drag) return out
    let y = Math.min(...[...slots.current.values()].map((s) => s.top))
    for (const [i, row] of shown.current.entries()) {
      const at = slots.current.get(row.id)
      if (!at) return new Map()
      if (i > 0) y += at.gap
      if (y !== at.top) out.set(row.id, y - at.top)
      y += at.height
    }
    return out
  }
  return {
    props,
    body,
    dragging: drag?.fromRow ?? null,
    /** Call once per render with the rows in drawn order; returns each row's place. */
    places: (rows: readonly NavRow[]) => {
      const by = shifts(rows)
      return (row: NavRow): RowPlace => {
        const dy = by.get(row.id)
        return dy ? { "data-row": row.id, style: { transform: `translateY(${dy}px)` } } : { "data-row": row.id }
      }
    },
  }
}
