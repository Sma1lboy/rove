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
 * At rest it draws nothing — the pane's own `│` is the edge. Under the cursor,
 * and for as long as a drag it started is live, that line turns into `⋮` in
 * the border's own color: same cell, same color, only the glyph says "this
 * one moves". It spans the rows BETWEEN the pane's corners, so `╭` `╰` stay
 * the frame's — and it paints itself rather than a child, because a child
 * would take the hit and bounce `over`/`out` back up to the grip. The terminal's pointer also becomes the four-way `move` shape where
 * the terminal honours OSC 22 (iTerm2 doesn't — hence the glyph).
 *
 * Both ride opentui's `over`/`out`, which fire when the cell under the pointer
 * CHANGES owner, not on every motion report: crossing the edge repaints this
 * one-cell column twice (in, out), never once per motion.
 *
 * This is only the handle. The gesture it arms is finished by the pane row
 * above it, for reasons that belong with the gesture —
 * `sidebar-resize-gesture.ts`.
 */

import type { BorderCharacters, CliRenderer, RGBA } from "@opentui/core"
import { useRenderer } from "@opentui/react"
import { useEffect, useRef, useState } from "react"
import type { GestureMouseEvent } from "./sidebar-resize-gesture"

export interface SidebarResizeGripProps {
  /** The rail's width — the grip sits on the column right after it. */
  readonly width: number
  /** The workspace border's current color — the `⋮` is drawn in it. */
  readonly color: string | RGBA
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
  const [hovering, setHovering] = useState(false)
  const lit = hovering || props.active === true
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
      top={1}
      bottom={1}
      left={props.width}
      width={1}
      // Border props ONLY while lit: opentui turns a border on the moment
      // `borderColor` or `customBorderChars` is set, whatever `border` says.
      {...(lit ? { border: ["left"], borderColor: props.color, customBorderChars: DOTTED_EDGE } : { border: false })}
      onMouseDown={props.onGripDown}
      onMouseOver={() => {
        hovered.current = true
        setHovering(true)
        sync()
      }}
      onMouseOut={() => {
        hovered.current = false
        setHovering(false)
        sync()
      }}
    />
  )
}

/** Only `vertical` is ever drawn: a left-only border has no corners. */
const DOTTED_EDGE: BorderCharacters = {
  topLeft: "⋮",
  topRight: "⋮",
  bottomLeft: "⋮",
  bottomRight: "⋮",
  horizontal: " ",
  vertical: "⋮",
  topT: "⋮",
  bottomT: "⋮",
  leftT: "⋮",
  rightT: "⋮",
  cross: "⋮",
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
