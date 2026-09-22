/** @jsxImportSource @opentui/react */
/**
 * The rail's right edge, draggable.
 *
 * It sits on the workspace pane's left border — the one line on screen that
 * already reads as "the rail ends here" — absolute over that column, so it
 * spends no cell of its own. Not the rail's last (padding) column: that is
 * blank, one cell left of the line people aim for, so a grab there is found
 * only by accident.
 *
 * It draws NOTHING. What says "this edge drags" is the mouse pointer: under the
 * cursor, and for as long as a drag it started is live, the terminal's pointer
 * becomes the four-way `move` shape (OSC 22 — terminals without it keep their
 * arrow). The switch rides opentui's `over`/`out`, which fire when the cell
 * under the pointer CHANGES owner, not on every motion report, and it goes
 * through refs, not state — the grip never re-renders for it.
 *
 * This is only the handle. The gesture it arms is finished by the pane row
 * above it, for reasons that belong with the gesture —
 * `sidebar-resize-gesture.ts`.
 */

import type { CliRenderer } from "@opentui/core"
import { useRenderer } from "@opentui/react"
import { useEffect, useRef } from "react"
import type { GestureMouseEvent } from "./sidebar-resize-gesture"

export interface SidebarResizeGripProps {
  /** The rail's width — the grip sits on the column right after it. */
  readonly width: number
  /** A drag the grip started is still live — keep the pointer until release. */
  readonly active?: boolean
  readonly onGripDown: (event: GestureMouseEvent) => void
}

export function SidebarResizeGrip(props: SidebarResizeGripProps) {
  const renderer = useRenderer()
  const hovered = useRef(false)
  const active = useRef(props.active === true)
  active.current = props.active === true
  const shown = useRef(false)
  // Only on a change: the grip owns the pointer while it wants it and hands
  // back `default` exactly once, so it never stomps a shape it didn't set.
  const sync = () => {
    const want = hovered.current || active.current
    if (want === shown.current) return
    shown.current = want
    writePointer(renderer, want ? "move" : "default")
  }
  // A drag ends away from the grip (release lands on whatever pane is under
  // the cursor), so the release has to be what drops the pointer.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `sync` reads refs; `props.active` is the trigger.
  useEffect(sync, [props.active])
  // Folding the rail mid-hover unmounts the grip before any `out` arrives.
  useEffect(
    () => () => {
      if (shown.current) writePointer(renderer, "default")
    },
    [renderer],
  )
  return (
    // biome-ignore lint/a11y/useKeyWithMouseEvents: a DOM rule — this terminal cell never takes keyboard focus, and the hover only changes the pointer; it triggers nothing.
    <box
      position="absolute"
      top={0}
      bottom={0}
      left={props.width}
      width={1}
      onMouseDown={props.onGripDown}
      onMouseOver={() => {
        hovered.current = true
        sync()
      }}
      onMouseOut={() => {
        hovered.current = false
        sync()
      }}
    />
  )
}

/**
 * opentui sends the pointer escape only inside a frame, and a grip that paints
 * nothing schedules none — without the request, the shape waited for some
 * unrelated repaint (measured: leaving the edge never restored the arrow).
 */
function writePointer(renderer: CliRenderer, shape: "move" | "default"): void {
  renderer.setMousePointer(shape)
  renderer.requestRender()
}
