/** @jsxImportSource @opentui/react */
/**
 * A modal barrier registered by an ABANDONED renderer's tree must never land
 * in the live stack. The harness destroys a renderer without unmounting React
 * (see `harness.tsx`), so a pending timer in a previous test's tree can open a
 * dialog long after the next test mounted — after `ensureInstalled` cleared the
 * stack. `modalActive()` then reads true forever and every raw `keyInput`
 * listener gated on it goes silent, including the terminal pane's paste
 * forwarder. That is the render-track paste flake, made deterministic here.
 */

import { expect, test } from "bun:test"
import { useEffect, useState } from "react"
import { useBindings } from "../../src/tui-react/lib/keymap"
import { Terminal } from "../../src/tui-react/panes/terminal/Terminal"
import { createScriptedPtyRegistry } from "../../src/tui/panes/terminal/pty-scripted"
import { act, renderComponent, settle } from "./harness"

const ABANDONED_SCOPE = Symbol("abandoned-modal-scope")

function LateBarrier() {
  useBindings(() => ({ bindings: [], modal: true }), { modalOwner: ABANDONED_SCOPE })
  return null
}

/** Opens its barrier on a timer, so the registration lands after the next renderer took over. */
function LateModal() {
  // Registering at mount is what makes this renderer the installed one, so the
  // next `renderComponent` supersedes it — the shape every render test has.
  useBindings(() => ({ bindings: [] }))
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setOpen(true), 120)
    return () => clearTimeout(timer)
  }, [])
  return open ? <LateBarrier /> : null
}

test("a superseded renderer's late modal barrier does not mute the live pane's paste", async () => {
  await renderComponent(<LateModal />, { width: 40, height: 6 })

  const harness = createScriptedPtyRegistry()
  const { mockInput, frame } = await renderComponent(
    <Terminal cwd="/wt" taskId="superseded-modal" focused registry={harness.registry} />,
    { width: 60, height: 12, providers: { dialog: true } },
  )
  await frame()

  // Past the abandoned tree's timer: its barrier registers here, if it can.
  // The abandoned root updates outside `act` here by design — that is the
  // scenario. React logs one "not wrapped in act" warning; nothing to fix.
  await settle(300)

  act(() => mockInput.pressKey("\x1b[200~first line\rsecond line\x1b[201~"))
  await settle()

  expect(harness.last().pastes).toEqual(["first line\rsecond line"])
})
