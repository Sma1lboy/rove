/** @jsxImportSource @opentui/react */
/**
 * The rail's right edge, draggable.
 *
 * It spends no column: absolute over the rail's rightmost cell, which is the
 * padding the row budgets already reserve (`titleBudgetFor` keeps a right pad
 * plus a breathing cell), so nothing clickable moves out from under it. A
 * visible divider column would have cost a cell of every row in the
 * tallest-pressure panel in the product.
 *
 * It draws NOTHING — no tint, no hover state. This is a hit area, not a
 * control: the only thing it has to do is be under the cursor when the press
 * lands, and a cell that repaints on every pointer motion across the rail's
 * edge is a repaint the resize does not need.
 *
 * This is only the handle. The gesture it arms is finished by the pane row
 * above it, for reasons that belong with the gesture —
 * `sidebar-resize-gesture.ts`.
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
