/** @jsxImportSource @opentui/react */
/**
 * Task creation is a labelled, full-row sidebar action rather than a tiny
 * header glyph. Assert against a real frame and a real mouse click: both the
 * hierarchy and the hit target are rendered behavior, not component props.
 */

import { expect, test } from "bun:test"
import { SidebarCreateAction } from "../../src/tui-react/panes/sidebar/chrome"
import { renderComponent } from "./harness"

function lineOf(frame: string, needle: string): number {
  return frame.split("\n").findIndex((line) => line.includes(needle))
}

test("clicking anywhere on the action row creates a task", async () => {
  let calls = 0
  const { frame, mockMouse } = await renderComponent(<SidebarCreateAction onAddTask={() => calls++} />, {
    width: 24,
    height: 5,
  })
  const text = await frame()

  await mockMouse.click(12, lineOf(text, "New task"))
  expect(calls).toBe(1)
})

test("the action row costs exactly one line — no vertical padding", async () => {
  // The sidebar is the most row-starved panel in the product; a one-line
  // button wrapped in vertical padding burned three rows for one row of
  // content. The row must start on the very first line of its own subtree.
  const { frame } = await renderComponent(<SidebarCreateAction onAddTask={() => {}} />, {
    width: 24,
    height: 3,
  })
  const lines = (await frame()).split("\n")
  expect(lines[0]).toContain("New task")
})
