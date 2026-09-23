/** @jsxImportSource @opentui/react */
/**
 * Narrow-mode breakpoint under a REAL opentui renderer:
 * proves the flag consumers derive from `useTerminalDimensions().width`
 * flips live when the terminal resizes across the 70-col boundary — the
 * same reactive path the workspace host will branch its layout on.
 */

import { expect, test } from "bun:test"
import { isNarrowWidth } from "../../src/tui-react/lib/narrow-mode"
import { useTerminalDimensions } from "../../src/tui-react/lib/use-terminal-dimensions"
import { act, renderComponent } from "./harness"

const PROBES = Array.from({ length: 12 }, (_, i) => `probe-${i}`)

function NarrowProbe() {
  const dims = useTerminalDimensions()
  return <text>{isNarrowWidth(dims.width) ? "layout:narrow" : "layout:wide"}</text>
}

test("narrow flag flips live on resize across the breakpoint", async () => {
  const { frame, resize, renderer } = await renderComponent(
    <box>
      {PROBES.map((id) => (
        <NarrowProbe key={id} />
      ))}
    </box>,
    { width: 80, height: 24 },
  )
  expect(await frame()).toContain("layout:wide")
  // Twelve callers, one renderer listener: past ten, Node prints a warning over the TUI.
  expect(renderer.listenerCount("resize")).toBeLessThan(10)

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
