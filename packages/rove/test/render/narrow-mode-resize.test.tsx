/** @jsxImportSource @opentui/react */
/**
 * Narrow-mode breakpoint under a REAL opentui renderer:
 * proves the flag consumers derive from `useTerminalSize().width`
 * flips live when the terminal resizes across the 70-col boundary — the
 * same reactive path the workspace host will branch its layout on.
 */

import { expect, test } from "bun:test"
import { isNarrowWidth } from "../../src/tui-react/lib/narrow-mode"
import { useTerminalSize } from "../../src/tui-react/lib/use-terminal-size"
import { act, renderComponent } from "./harness"

function NarrowProbe() {
  const dims = useTerminalSize()
  return <text>{isNarrowWidth(dims.width) ? "layout:narrow" : "layout:wide"}</text>
}

test("narrow flag flips live on resize across the breakpoint", async () => {
  const { frame, resize } = await renderComponent(<NarrowProbe />, { width: 80, height: 24 })
  expect(await frame()).toContain("layout:wide")

  // Phone-SSH target viewport (~46×70 cells).
  await act(async () => {
    resize(46, 70)
  })
  expect(await frame()).toContain("layout:narrow")

  // Back to exactly the breakpoint — desktop layout, not narrow.
  await act(async () => {
    resize(70, 24)
  })
  expect(await frame()).toContain("layout:wide")
})
