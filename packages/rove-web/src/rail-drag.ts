/**
 * Drag to reorder: a project header among projects (`project.move`, the whole project, with or without a
 * main checkout), a task among its project's tasks, as the TUI's move mode does with keys. A task let go at the top of its project or among its pinned tasks is
 * pinned; a pinned one let go among the rest is unpinned. While dragging, the rows slide to where
 * the drop would leave them; there is no insertion line. They slide by transform, not by reordering
 * the DOM: Chrome cancels a drag whose source node moves. Any sort drags; a drop outside manual
 * order lands in manual order and the rail switches to it, the only sort that shows where the row went.
 */

import type { CSSProperties, DragEvent, HTMLAttributes } from "react"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import type { TaskRow } from "rove-bridge/protocol"
import type { AppModel } from "./model.ts"
import { dropTask } from "./move-mode.ts"
import { type DropSide, blockEnd, dropMove, dropsOn, opensProject, previewDrop } from "./rail-blocks.ts"
import { setRailSort } from "./rail-sort.ts"
import { type NavRow, isNoProject } from "./rail.ts"
import { tc } from "./tui-copy.ts"
import { toast } from "./ui.ts"

export type DragProps = Pick<HTMLAttributes<HTMLElement>, "draggable" | "onDragStart" | "onDragEnd">

export interface RowPlace {
  readonly "data-row": string
  readonly style?: CSSProperties
}

interface Drag {
  readonly fromRow: string
  /** A task drag's task; a project drag's first task, standing for its project. */
  readonly from: TaskRow
  readonly toRow: string
  readonly to: TaskRow
  readonly side: DropSide
  readonly project: boolean
}

let blank: HTMLImageElement | null = null
/** The browser's translucent copy of the row would float over the rows already sliding into place. */
const noGhost = (): HTMLImageElement => {
  if (!blank) {
    blank = new Image()
    blank.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
  }
  return blank
}

export function useRowDrag(
  model: AppModel,
  tasks: readonly TaskRow[],
  enabled: boolean,
  /** The rail shows manual order (the `default` sort). */
  manual: boolean,
) {
  const [drag, setDrag] = useState<Drag | null>(null)
  const latest = useRef(tasks)
  latest.current = tasks
  // After a drop: the task list on screen when the last move returned. The preview holds until a newer one arrives.
  const [landing, setLanding] = useState<readonly TaskRow[] | null>(null)
  // What ends the preview once the move has landed: clearing it, or switching to manual order.
  const land = useRef<() => void>(() => setDrag(null))
  useEffect(() => {
    if (!landing) return
    const done = () => {
      setLanding(null)
      land.current()
    }
    if (tasks !== landing) return done()
    const timer = window.setTimeout(done, 3000)
    return () => window.clearTimeout(timer)
  }, [tasks, landing])
  const railBody = useRef<Element | null>(null)
  // Where each row was drawn just before a sort switch, so it can slide to its new place.
  const flip = useRef<Map<string, number> | null>(null)
  const rowEls = () => [...(railBody.current?.querySelectorAll<HTMLElement>("[data-row]") ?? [])]
  useLayoutEffect(() => {
    const from = flip.current
    if (!from) return
    flip.current = null
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const moved = rowEls().flatMap((el) => {
      const was = from.get(el.dataset.row ?? "")
      const dy = was === undefined ? 0 : was - el.getBoundingClientRect().top
      return dy ? [{ el, dy }] : []
    })
    for (const { el, dy } of moved) {
      el.style.transition = "none"
      el.style.transform = `translateY(${dy}px)`
    }
    // One reflow pins every row at its old place before they all slide at once.
    railBody.current?.getBoundingClientRect()
    for (const { el } of moved) {
      el.style.transition = "transform 150ms ease-out"
      el.style.transform = ""
      el.addEventListener("transitionend", () => el.style.removeProperty("transition"), { once: true })
    }
  })
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
    // Any project moves, main checkout or not; Ungrouped is not one.
    if (row.kind === "project")
      return row.noProject ? null : (tasks.find((task) => task.repo === row.repo && !isNoProject(task)) ?? null)
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
        e.dataTransfer.setDragImage(noGhost(), 0, 0)
        e.dataTransfer.setData("text/plain", task.id)
        railBody.current = e.currentTarget.closest("[data-rail-body]")
        measure(railBody.current)
        const rows = shown.current
        const from = rows.findIndex((r) => r.id === row.id)
        blockHeight.current = rows
          .slice(from, blockEnd(rows, from))
          .reduce(
            (h, r, i) => h + (slots.current.get(r.id)?.height ?? 0) + (i > 0 ? (slots.current.get(r.id)?.gap ?? 0) : 0),
            0,
          )
        lastY.current = e.clientY
        set({ fromRow: row.id, from: task, toRow: row.id, to: task, side: "above", project: row.kind === "project" })
      },
      // A drop already let go of `live` and keeps its preview; this is the cancelled drag.
      onDragEnd: () => live.current && set(null),
    }
  }
  // The row a drag over `rows[i]` aims at: for a project, the project that row is in (its header);
  // for a task, that task.
  const targetAt = (rows: readonly NavRow[], i: number, now: Drag): { row: string; task: TaskRow } | null => {
    let at = i
    if (now.project) while (at > 0 && rows[at]?.kind !== "project") at--
    const row = rows[at]
    if (!row || (row.kind === "project") !== now.project) return null
    const task = taskOf(row)
    if (!task || (!now.project && !dropsOn(now.from, task))) return null
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
      live.current = null
      if (!manual) {
        // Manual order is the only sort that shows where the row went: switch to it once the move has
        // landed, sliding every row from where the preview drew it.
        land.current = () => {
          flip.current = new Map(rowEls().map((el) => [el.dataset.row ?? "", el.getBoundingClientRect().top]))
          setDrag(null)
          setRailSort("default")
          toast(tc("tasks", "sort.label", { mode: tc("tasks", "sort.modes.default") }))
        }
      } else land.current = () => setDrag(null)
      // The preview stays until the daemon's new order has arrived, so the row doesn't jump back first.
      const settle = () => setLanding(latest.current)
      if (now.project) {
        if (now.toRow === now.fromRow) return land.current()
        const args = { repo: now.from.repo, target: now.to.repo, side: now.side === "above" ? "before" : "after" }
        void model.client
          .request("project.move", args)
          .catch((err: unknown) =>
            toast(
              tc("tasks", "toast.moveFailed", { error: err instanceof Error ? err.message : String(err) }),
              "error",
            ),
          )
          .finally(settle)
        return
      }
      const move = dropMove(tasks, now.from, now.to, now.side, opensProject(shown.current, now.fromRow, now.toRow))
      if (move) void dropTask(model, now.from.id, move).finally(settle)
      else land.current()
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
    // The first header was drawn with no gap above it; once moved down it takes the gap every group has.
    const isHead = (row: NavRow) => row.kind === "project" || row.kind === "state"
    const groupGap = Math.max(0, ...rows.filter(isHead).map((row) => slots.current.get(row.id)?.gap ?? 0))
    for (const [i, row] of shown.current.entries()) {
      const at = slots.current.get(row.id)
      if (!at) return new Map()
      if (i > 0) y += isHead(row) ? groupGap : at.gap
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
