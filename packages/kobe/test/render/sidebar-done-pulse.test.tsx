/** @jsxImportSource @opentui/react */
/**
 * The sidebar's landing flash — `useDonePulse`, the hook that makes a tab row
 * emphasize for {@link DONE_PULSE_MS} when a turn lands.
 *
 * Tested through a probe that prints the hook's answer, because the thing that
 * can be wrong here is the EDGE, not the styling: `turn_complete` sits on a
 * row for as long as nobody reads it, so a pulse that keyed on the state (or
 * that re-armed on any re-render) would leave a rail of permanently bold rows,
 * and a still frame of a bold row looks exactly like a still frame of a row
 * that is stuck bold. The two-line JSX that turns the boolean into BOLD is
 * covered by the sidebar frame goldens.
 */

import { expect, test } from "bun:test"
import { useState } from "react"
import { useDonePulse } from "../../src/tui-react/panes/sidebar/row-cards"
import { DONE_PULSE_MS } from "../../src/tui/panes/sidebar/row-view"
import { act, renderComponent } from "./harness"

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Renders the hook's answer as text, with the stamp driven from outside. */
function Probe(props: { readonly initial: number | undefined; readonly bind: (set: Setter) => void }) {
  const [stamp, setStamp] = useState<number | undefined>(props.initial)
  props.bind(setStamp)
  const pulsing = useDonePulse(stamp)
  return <text>{pulsing ? "PULSE" : "rest"}</text>
}

type Setter = (next: number | undefined) => void

async function probe(initial: number | undefined) {
  let set: Setter = () => {}
  const bind = (fn: Setter): void => {
    set = fn
  }
  const handle = await renderComponent(<Probe initial={initial} bind={bind} />, {
    width: 20,
    height: 3,
  })
  await wait(20)
  return { ...handle, set: (next: number | undefined) => act(() => set(next)) }
}

test("a completion already present at mount does NOT flash", async () => {
  // Mounting is not landing. Without the seed guard, every row that scrolls
  // into view — or the whole rail on a restart — would flash at once for
  // turns that finished minutes ago.
  const { frame } = await probe(1000)
  expect(await frame()).toContain("rest")
})

test("a NEW completion flashes, then settles on its own", async () => {
  const { frame, set } = await probe(undefined)
  expect(await frame()).toContain("rest")

  set(2000)
  await wait(20)
  expect(await frame()).toContain("PULSE")

  await wait(DONE_PULSE_MS + 80)
  expect(await frame()).toContain("rest")
})

test("the SAME completion re-rendered does not re-arm the flash", async () => {
  // `turn_complete` stays on the row until someone reads it, so the row
  // re-renders under the same stamp on every 2s branch tick. Re-arming there
  // is what would leave the rail permanently bold.
  const { frame, set } = await probe(undefined)
  set(3000)
  await wait(DONE_PULSE_MS + 80)
  expect(await frame()).toContain("rest")

  set(3000)
  await wait(20)
  expect(await frame()).toContain("rest")
})

test("a second completion flashes again", async () => {
  const { frame, set } = await probe(undefined)
  set(4000)
  await wait(DONE_PULSE_MS + 80)
  expect(await frame()).toContain("rest")

  set(5000)
  await wait(20)
  expect(await frame()).toContain("PULSE")
})

test("losing the completion (a new turn started) clears the flash immediately", async () => {
  const { frame, set } = await probe(undefined)
  set(6000)
  await wait(20)
  expect(await frame()).toContain("PULSE")

  // The row went back to `running`, so there is no completion to celebrate —
  // the flash must not outlive its own subject waiting for the timer.
  set(undefined)
  await wait(20)
  expect(await frame()).toContain("rest")
})
