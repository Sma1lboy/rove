/** @jsxImportSource @opentui/react */
/**
 * The rail's right edge, draggable.
 *
 * It spends no column: absolute over the rail's rightmost cell, which is the
 * padding the row budgets already reserve (`titleBudgetFor` keeps a right pad
 * plus a breathing cell), so nothing clickable moves out from under it. A
 * visible divider column would have cost a cell of every row in the
 * tallest-pressure panel in the product, for a hint the cursor can give for
 * free — the cell tints on hover instead, which is opentui's `over`/`out`
 * pair, live because the renderer enables motion reporting by default.
 *
 * This is only the handle and the hint. The gesture it arms is finished by the
 * pane row above it, for reasons that belong with the gesture —
 * `sidebar-resize-gesture.ts`.
 */

import { useState } from "react"
import { useTheme } from "../context/theme"
import type { GestureMouseEvent } from "./sidebar-resize-gesture"

export interface SidebarResizeGripProps {
  /** The rail's width — the grip sits on its last column. */
  readonly width: number
  readonly onGripDown: (event: GestureMouseEvent) => void
}

export function SidebarResizeGrip(props: SidebarResizeGripProps) {
  const { theme } = useTheme()
  const [hot, setHot] = useState(false)
  return (
    // biome-ignore lint/a11y/useKeyWithMouseEvents: the rule pairs onMouseOver with onFocus for DOM keyboard nav; an opentui box is not focusable and the tint is decoration — the rail still has a width without anyone touching this.
    <box
      position="absolute"
      top={0}
      bottom={0}
      left={props.width - 1}
      width={1}
      backgroundColor={hot ? theme.focusAccent : undefined}
      onMouseOver={() => setHot(true)}
      onMouseOut={() => setHot(false)}
      onMouseDown={props.onGripDown}
    />
  )
}
