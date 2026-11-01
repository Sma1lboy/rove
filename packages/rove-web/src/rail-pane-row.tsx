/** A split tab's pane in the rail: click focuses it, right click renames or closes it. */

import type { MouseEvent } from "react"
import type { AppModel } from "./model.ts"
import type { TreeGuide } from "./rail-blocks.ts"
import type { RowPlace } from "./rail-drag.ts"
import type { NavRow } from "./rail.ts"
import { activeLeafOf, activeLeaves, focusLeaf } from "./split-actions.tsx"
import { useStore } from "./store.ts"
import { ROW_TITLE, rowClass } from "./ui/row.ts"

export type PaneRow = Extract<NavRow, { kind: "pane" }>

/** Select the pane's task and tab, then put the keyboard in the pane. */
export function openPane(model: AppModel, { task, tab, leaf }: PaneRow): void {
  if (tab.split) focusLeaf(task.id, tab, tab.split, leaf)
  model.select(task.id, tab.id)
}

export function PaneRowView(props: {
  model: AppModel
  row: PaneRow
  guides?: readonly TreeGuide[] | undefined
  cursor: boolean
  onClick: () => void
  onMenu: (e: MouseEvent) => void
  place: RowPlace
}) {
  const { row } = props
  const selection = useStore(props.model.selection)
  useStore(activeLeaves) // a focus change re-renders; `activeLeafOf` reads it
  const active =
    selection.taskId === row.task.id &&
    selection.tabId === row.tab.id &&
    !!row.tab.split &&
    activeLeafOf(row.task.id, row.tab, row.tab.split) === row.leaf
  return (
    <button
      type="button"
      className={`${rowClass({ size: "pane" })} ${props.cursor ? "is-cursor" : ""}`}
      aria-current={active || undefined}
      onClick={props.onClick}
      onContextMenu={props.onMenu}
      {...props.place}
    >
      <span className="child-indent" aria-hidden="true">
        {props.guides?.map((guide, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a column's place is its identity
          <span key={i} className={`guide is-${guide}`} />
        ))}
      </span>
      <span className={`${ROW_TITLE} text-(length:--fs-meta) ${active ? "text-ink" : "text-muted"}`}>{row.label}</span>
    </button>
  )
}
