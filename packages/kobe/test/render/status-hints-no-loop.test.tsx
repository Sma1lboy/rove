/** @jsxImportSource @opentui/react */
/**
 * The status hint row must not re-run its snapshot effect on every render.
 *
 * React error #185 ("Maximum update depth exceeded") crashed the workspace
 * while deleting tasks in a burst. `useStatusKeyHintItems` renders in the
 * workspace FOOTER, which wraps the whole pane tree, so its `setState`
 * re-renders every sidebar row — and each row's `useBindings` bumps the
 * binding-stack version on unmount/remount, which re-renders the footer.
 * The effect had no dependency array, so it ran on every one of those
 * renders, leaving only its compare-and-set between that cycle and an
 * infinite loop.
 *
 * What is pinned here is the shape, not the crash: the effect runs when its
 * inputs change, and NOT once per render. A render that changes none of its
 * inputs must not re-run it — that is the property whose absence made the
 * loop possible at all.
 */

import { expect, test } from "bun:test"
import { useState } from "react"
import { useStatusKeyHintItems } from "../../src/tui-react/component/keyboard-hints"
import { useBindings } from "../../src/tui-react/lib/keymap"
import { act, renderComponent } from "./harness"

/** A sidebar row: registers bindings, so mounting/unmounting bumps the stack. */
function Row(props: { n: number; focused: boolean }) {
  useBindings(() => ({
    enabled: props.focused,
    bindings: [{ key: "x", id: `row.${props.n}`, cmd: () => {} }],
  }))
  return <text>{`row ${props.n}`}</text>
}

let footerRenders = 0

/** The real nesting: the hints hook lives in a PARENT that wraps the rows. */
function Footer(props: { children: React.ReactNode }) {
  footerRenders++
  const items = useStatusKeyHintItems()
  return (
    <box flexDirection="column">
      {props.children}
      <text>{`hints:${items.length}`}</text>
    </box>
  )
}

function App() {
  const [rows, setRows] = useState([1, 2, 3, 4, 5])
  const [focus, setFocus] = useState(1)
  const [tick, setTick] = useState(0)
  useBindings(() => ({
    enabled: true,
    bindings: [
      // `d` deletes a row AND moves focus — the churn a real delete produces.
      {
        key: "d",
        id: "probe.del",
        cmd: () => {
          setRows((r) => r.slice(1))
          setFocus((f) => f + 1)
        },
      },
      // `t` re-renders the tree while changing NONE of the hint inputs.
      { key: "t", id: "probe.tick", cmd: () => setTick((n) => n + 1) },
    ],
  }))
  return (
    <Footer>
      <text>{`tick ${tick}`}</text>
      {rows.map((n) => (
        <Row key={n} n={n} focused={n === focus} />
      ))}
    </Footer>
  )
}

test("deleting rows in a burst settles instead of looping", async () => {
  footerRenders = 0
  const { frame, mockInput } = await renderComponent(<App />, { width: 80, height: 12 })
  await act(async () => {})
  const base = footerRenders

  for (let i = 0; i < 5; i++) {
    mockInput.typeText("d")
    await act(async () => {})
  }

  // Each delete costs a bounded number of renders. An unbounded count is the
  // loop; React's own #185 guard trips at 50 nested updates, so a per-delete
  // budget well under that catches the runaway before React has to.
  expect(footerRenders - base).toBeLessThan(30)
  // Still alive and rendering (a crashed tree paints the pane-crash box).
  expect(await frame()).toContain("hints:")
})

test("a render that changes no hint input does not re-run the snapshot", async () => {
  // The regression guard proper. Without a dependency array this effect ran
  // on EVERY render, which is the precondition for the loop above; the
  // compare-and-set only hid it. Here the tree re-renders with the same
  // focus, same bindings, same keymap — the effect must stay quiet.
  const { frame, mockInput } = await renderComponent(<App />, { width: 80, height: 12 })
  await act(async () => {})

  footerRenders = 0
  for (let i = 0; i < 10; i++) {
    mockInput.typeText("t")
    await act(async () => {})
  }

  // 10 keypresses, each one render of the tree. If the effect re-ran and
  // re-set state on every render, this would be 20+.
  expect(footerRenders).toBeLessThanOrEqual(12)
  expect(await frame()).toContain("tick 10")
})
