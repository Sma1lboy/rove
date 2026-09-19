/** @jsxImportSource @opentui/react */
/**
 * The rail's drag grip, against real mouse events.
 *
 * Every claim here is one a props-level assertion cannot make, because what
 * breaks is ROUTING, not arithmetic. opentui hands pointer capture to whatever
 * sits under the cursor on the first motion report, so a grip that is one cell
 * wide is handed the press and then never hears from the gesture again — and
 * that failure renders identically to a working grip. The component mounts,
 * the handlers exist, and the rail simply never moves.
 *
 * So these mount the real split — grip on the rail's edge, gesture finished by
 * the row that holds the panes — and drive press → travel → release through
 * the renderer's own mouse pipeline. A version that expanded the grip on press
 * instead passed a browser driver (which pauses 30ms between press and move,
 * long enough for a React commit) and failed here, which is the honest answer:
 * a real flick of the wrist does not wait for a frame either.
 */

import { expect, test } from "bun:test"
import { useSidebarResizeGesture } from "../../src/tui-react/workspace/sidebar-resize-gesture"
import { SidebarResizeGrip } from "../../src/tui-react/workspace/sidebar-resize-grip"
import { renderComponent } from "./harness"

const RAIL_WIDTH = 24
/** The grip's own column: the rail's last cell, zero-indexed. */
const EDGE_X = RAIL_WIDTH - 1
const ROW_Y = 6

/** The workspace's shape in miniature: a pane row with a rail inside it. */
function Workspace(props: { onResize?: (w: number) => void; onReset?: () => void }) {
  const gesture = useSidebarResizeGesture({
    width: RAIL_WIDTH,
    onResize: props.onResize ?? (() => {}),
    onReset: props.onReset ?? (() => {}),
  })
  return (
    <box width={60} height={12} flexDirection="row" onMouseDrag={gesture.onPaneDrag} onMouseUp={gesture.onPaneRelease}>
      <box width={RAIL_WIDTH} height={12} />
      <box flexGrow={1} height={12} />
      <SidebarResizeGrip width={RAIL_WIDTH} onGripDown={gesture.onGripDown} />
    </box>
  )
}

test("a drag that leaves the grip still resizes, by the cursor's travel", async () => {
  const widths: number[] = []
  const { mockMouse, rerender } = await renderComponent(<Workspace onResize={(w) => widths.push(w)} />, {
    width: 60,
    height: 12,
  })

  await mockMouse.pressDown(EDGE_X, ROW_Y)
  // Each step leaves the grip's column further behind — the case that silently
  // did nothing while the grip tried to own the gesture itself.
  for (const x of [30, 38, 45]) {
    await mockMouse.moveTo(x, ROW_Y)
  }
  await mockMouse.release(45, ROW_Y)
  await rerender()

  expect(widths.length).toBeGreaterThan(0)
  // Offset from the press, not the cursor's absolute column: the gesture never
  // learns where the rail's left edge is, so the two only agree by accident.
  expect(widths.at(-1)).toBe(RAIL_WIDTH + (45 - EDGE_X))
})

test("dragging anywhere else in the workspace resizes nothing", async () => {
  const widths: number[] = []
  const { mockMouse, rerender } = await renderComponent(<Workspace onResize={(w) => widths.push(w)} />, {
    width: 60,
    height: 12,
  })

  // Same row, same handler — but the press never touched the grip, so this is
  // somebody selecting text in a pane, not a resize.
  await mockMouse.pressDown(40, ROW_Y)
  await mockMouse.moveTo(50, ROW_Y)
  await mockMouse.release(50, ROW_Y)
  await rerender()

  expect(widths).toEqual([])
})

test("double-click on the grip clears the pin, a lone click does not", async () => {
  let resets = 0
  const { mockMouse, rerender } = await renderComponent(<Workspace onReset={() => resets++} />, {
    width: 60,
    height: 12,
  })

  await mockMouse.click(EDGE_X, ROW_Y)
  await rerender()
  expect(resets).toBe(0)

  await mockMouse.click(EDGE_X, ROW_Y)
  await rerender()
  expect(resets).toBe(1)
})

test("two quick drags are two resizes, not a double-click", async () => {
  let resets = 0
  const { mockMouse, rerender } = await renderComponent(<Workspace onReset={() => resets++} />, {
    width: 60,
    height: 12,
  })

  for (const _ of [0, 1]) {
    await mockMouse.pressDown(EDGE_X, ROW_Y)
    await mockMouse.moveTo(40, ROW_Y)
    await mockMouse.release(40, ROW_Y)
  }
  await rerender()

  // Both releases land inside the double-click window, and both gestures
  // MOVED: setting a width twice in a row must not throw the second one away.
  expect(resets).toBe(0)
})
