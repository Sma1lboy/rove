/**
 * The panel beside the task terminal: the task's open views (Files, a diff, a Browser, Context, Chat)
 * as side-by-side columns, each with its own slim header, sharing the panel's width between dividers.
 * Only the Browser has tabs. In narrow mode the bar's Terminal/Files/Diff/Browser switch picks the kind
 * and this renders that one column.
 */

import { type PointerEvent, type RefObject, useEffect, useRef } from "react"
import type { TaskRow } from "rove-bridge/protocol"
import { t, useLocale } from "./i18n/index.ts"
import { openMachines } from "./machines-dialog.tsx"
import { RemoteNotice } from "./machines-view.tsx"
import type { AppModel } from "./model.ts"
import { ColumnDivider, ColumnHead, ColumnView } from "./panel-column.tsx"
import { clampPanelWidth, narrowView, panelExpanded, panelWidth } from "./panel-layout.ts"
import { type Column, type PanelKind, columnOf, columnWeights, showKind } from "./panel-model.ts"
import { editPanel, usePanelShown, useTaskPanel } from "./panel-state.ts"
import { RAIL_DEFAULT_PX, clampRailWidth, railFolded, railWidth } from "./rail-layout.ts"
import { useStore } from "./store.ts"
import { dragLayout, zen } from "./ui.ts"
import { SIDE_BODY, SIDE_COLUMN, sidePanelClass } from "./ui/panel.ts"
import { ResizeGrip } from "./ui/resize-grip.tsx"

/** The panel's left edge: drag to pin a width, double-click to go back to the automatic one. */
function PanelGrip({ panel }: { panel: RefObject<HTMLElement | null> }) {
  useLocale()
  const drag = useRef<{ x: number; width: number } | null>(null)
  const down = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = { x: e.clientX, width: panel.current?.getBoundingClientRect().width ?? 0 }
    // A frame under the pointer would swallow the drag.
    panel.current?.classList.add("is-resizing")
    e.currentTarget.setPointerCapture(e.pointerId)
    dragLayout(true)
  }
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const from = drag.current
    if (!from || e.clientX === from.x) return
    const railPx = railFolded.get() ? 0 : clampRailWidth(railWidth.get() ?? RAIL_DEFAULT_PX)
    panelWidth.set(clampPanelWidth(from.width - (e.clientX - from.x), railPx))
  }
  return (
    <ResizeGrip
      edge="left"
      title={t("panel.resize")}
      onPointerDown={down}
      onPointerMove={move}
      onLostPointerCapture={() => {
        drag.current = null
        panel.current?.classList.remove("is-resizing")
        dragLayout(false)
      }}
      onDoubleClick={() => panelWidth.set(null)}
    />
  )
}

/** What identifies a column's content: a retargeted diff is a different view, not the one restored. */
const viewKey = (col: Column): string => (col.kind === "diff" ? `diff:${col.path}:${col.scope}` : col.kind)

function TaskPanel({ model, task, narrow }: { model: AppModel; task: TaskRow; narrow: boolean }) {
  useLocale()
  const panel = useTaskPanel(task.id)
  const narrowKind = useStore(narrowView)
  const expanded = useStore(panelExpanded)
  const aside = useRef<HTMLElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const kind: PanelKind = narrowKind === "terminal" ? "files" : narrowKind
  // The phone's panel shows one column: the chosen kind, opened when it is not.
  const chosen = narrow ? columnOf(panel, kind) : undefined
  useEffect(() => {
    if (narrow && !chosen) editPanel(task.id, (p) => showKind(p, kind))
  }, [narrow, chosen, kind, task.id])

  const visible = narrow ? (chosen ? [chosen] : []) : panel.columns
  const kinds = visible.map((col) => col.kind)
  const shares = narrow ? [1] : columnWeights(panel)
  const tracks = shares.map((share, i) => `${i > 0 ? "var(--divider) " : ""}minmax(0, ${share}fr)`).join(" ")
  // Columns on screen when the panel first drew were restored, not opened: they leave the keyboard alone.
  const restored = useRef(visible.map(viewKey))

  return (
    <aside className={sidePanelClass(narrow)} ref={aside}>
      {!narrow && !expanded && <PanelGrip panel={aside} />}
      <div className={SIDE_BODY} ref={body} style={{ gridTemplateColumns: tracks }}>
        {visible.map((col) => (
          <section
            key={col.kind}
            className={SIDE_COLUMN}
            data-kind={col.kind}
            style={{ gridColumn: 2 * kinds.indexOf(col.kind) + 1 }}
          >
            <ColumnHead taskId={task.id} column={col} narrow={narrow} />
            <ColumnView
              model={model}
              task={task}
              column={col}
              narrow={narrow}
              restored={restored.current.includes(viewKey(col))}
            />
          </section>
        ))}
        {!narrow &&
          visible
            .slice(1)
            .map((col, i) => (
              <ColumnDivider
                key={`divider:${col.kind}`}
                taskId={task.id}
                kinds={kinds}
                index={i}
                body={body}
                slot={2 * i + 2}
              />
            ))}
      </div>
    </aside>
  )
}

/**
 * Desktop: the grid's right column, hidden by zen or by closing its last column. A task on another
 * machine has no files or page here, so its panel says where it lives. Narrow: the task's chosen view,
 * in the pane.
 */
export function SidePanel({
  model,
  task,
  remoteHost,
  narrow = false,
}: {
  model: AppModel
  task: TaskRow | null
  remoteHost?: string
  narrow?: boolean
}) {
  const zenOn = useStore(zen)
  const open = usePanelShown(task?.id ?? null)
  if (!narrow && (zenOn || !open)) return null
  if (task) return <TaskPanel key={task.id} model={model} task={task} narrow={narrow} />
  if (!remoteHost) return null
  return (
    <aside className={sidePanelClass(false)}>
      <RemoteNotice host={remoteHost} onMachines={() => openMachines(model)} />
    </aside>
  )
}
