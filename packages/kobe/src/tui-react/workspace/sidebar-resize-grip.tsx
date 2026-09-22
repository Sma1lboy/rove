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
 * At rest it draws nothing. Under the cursor, and for as long as a drag it
 * started is live, that same padding cell becomes a focus-accent rule — an
 * edge nobody can see is an edge nobody drags. The light follows opentui's
 * `over`/`out`, which fire when the cell under the pointer CHANGES owner, not
 * on every motion report: sweeping across the rail costs two renders (in,
 * out), not one per cell travelled.
 *
 * This is only the handle. The gesture it arms is finished by the pane row
 * above it, for reasons that belong with the gesture —
 * `sidebar-resize-gesture.ts`.
 */

import { useState } from "react"
import { useTheme } from "../context/theme"
import type { GestureMouseEvent } from "./sidebar-resize-gesture"

export interface SidebarResizeGripProps {
  /** The rail's width — the grip sits on its last column. */
  readonly width: number
  /** A drag the grip started is still live — stay lit after the cursor leaves. */
  readonly active?: boolean
  readonly onGripDown: (event: GestureMouseEvent) => void
}

export function SidebarResizeGrip(props: SidebarResizeGripProps) {
  const { theme } = useTheme()
  const [hovered, setHovered] = useState(false)
  const lit = hovered || props.active === true
  return (
    // biome-ignore lint/a11y/useKeyWithMouseEvents: a DOM rule — this terminal cell never takes keyboard focus, and the hover only paints; it triggers nothing.
    <box
      position="absolute"
      top={0}
      bottom={0}
      left={props.width - 1}
      width={1}
      border={lit ? ["left"] : false}
      borderColor={theme.focusAccent}
      onMouseDown={props.onGripDown}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
    />
  )
}
