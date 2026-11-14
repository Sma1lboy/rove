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

let lateBarrierMounted = false

function LateBarrier() {
  useBindings(() => ({ bindings: [], modal: true }), { modalOwner: ABANDONED_SCOPE })
  useEffect(() => {
    lateBarrierMounted = true
  }, [])
  return null
}

let openLateModal: () => void = () => {}

/** Opens its barrier on demand, so the registration lands after the next renderer took over. */
function LateModal() {
  // Registering at mount is what makes this renderer the installed one, so the
  // next `renderComponent` supersedes it — the shape every render test has.
  useBindings(() => ({ bindings: [] }))
  const [open, setOpen] = useState(false)
  useEffect(() => {
    openLateModal = () => setOpen(true)
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

  // The abandoned tree's barrier registers here, after the live renderer took over, if it can.
  act(() => openLateModal())
  expect(lateBarrierMounted).toBe(true)

  act(() => mockInput.pressKey("\x1b[200~first line\rsecond line\x1b[201~"))
  await settle()

  expect(harness.last().pastes).toEqual(["first line\rsecond line"])
})
