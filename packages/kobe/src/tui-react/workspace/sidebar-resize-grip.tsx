/** @jsxImportSource @opentui/react */
/**
 * The rail's draggable right edge. Spends no column: absolute over the rail's
 * last cell, the padding row budgets already reserve (`titleBudgetFor`), in
 * the tightest panel in the product. Draws NOTHING: a hit area, not a control,
 * so no repaint per pointer motion. The gesture it arms is finished by the pane
 * row (`sidebar-resize-gesture.ts`).
 */

import type { GestureMouseEvent } from "./sidebar-resize-gesture"

export interface SidebarResizeGripProps {
  /** The rail's width — the grip sits on its last column. */
  readonly width: number
  readonly onGripDown: (event: GestureMouseEvent) => void
}

export function SidebarResizeGrip(props: SidebarResizeGripProps) {
  return <box position="absolute" top={0} bottom={0} left={props.width - 1} width={1} onMouseDown={props.onGripDown} />
}
