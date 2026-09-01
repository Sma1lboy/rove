/** @jsxImportSource @opentui/react */
/**
 * The brand-row update chip — the passive half of the update surface. The
 * daemon's npm poll lands in `updateSignal`; this pins that a `hasUpdate`
 * payload renders a right-aligned, clickable chip on the ROVE brand row and
 * that no chip renders otherwise (regression: the consumer was lost with the
 * tmux runtime in #313 and the poll went nowhere for months).
 */

import { expect, test } from "bun:test"
import { SidebarBrandHeader } from "../../src/tui-react/panes/sidebar/chrome"
import { renderComponent } from "./harness"

function lineOf(frame: string, needle: string): number {
  return frame.split("\n").findIndex((line) => line.includes(needle))
}

test("renders the update chip right-aligned on the brand row", async () => {
  const { frame } = await renderComponent(
    <SidebarBrandHeader
      focused={false}
      status={{ label: "Inbox 0", emphasize: false }}
      update={{ label: "↑ 0.9.99" }}
    />,
    { width: 30, height: 3 },
  )
  const text = await frame()
  const row = text.split("\n")[lineOf(text, "ROVE")]

  // Same row as the brand text, version label intact, pushed to the right edge.
  expect(row).toMatch(/ROVE\s+Inbox 0\s+↑ 0\.9\.99/)
})

test("no update chip when there is nothing to update to", async () => {
  const { frame } = await renderComponent(
    <SidebarBrandHeader focused={false} status={{ label: "Inbox 0", emphasize: false }} update={null} />,
    { width: 30, height: 3 },
  )
  expect(await frame()).not.toContain("↑")
})

test("clicking the chip opens the update surface", async () => {
  let calls = 0
  const { frame, mockMouse } = await renderComponent(
    <SidebarBrandHeader
      focused={false}
      status={{ label: "Inbox 0", emphasize: false }}
      update={{ label: "↑ 0.9.99" }}
      onUpdateClick={() => calls++}
    />,
    { width: 30, height: 3 },
  )
  const text = await frame()
  const row = lineOf(text, "0.9.99")

  await mockMouse.click(text.split("\n")[row].indexOf("0.9.99"), row)
  expect(calls).toBe(1)
})
