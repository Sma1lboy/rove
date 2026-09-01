/** @jsxImportSource @opentui/react */

import { expect, test } from "bun:test"
import { useState } from "react"
import { useBindings } from "../../src/tui-react/lib/keymap"
import { Terminal } from "../../src/tui-react/panes/terminal/Terminal"
import { createScriptedPtyRegistry } from "../../src/tui/panes/terminal/pty-scripted"
import { act, renderComponent, settle } from "./harness"

function ComposerProbe() {
  const [value, setValue] = useState("")
  useBindings(() => ({ bindings: [] }))
  return <input focused value={value} onInput={setValue} />
}

test("kitty all-keys-as-escapes input still types into a composer", async () => {
  const { mockInput, frame } = await renderComponent(<ComposerProbe />, { width: 40, height: 4 })

  act(() => mockInput.pressKey("\x1b[57442;5u"))
  act(() => mockInput.pressKey("\x1b[97u"))
  act(() => mockInput.pressKey("\x1b[57442;1:3u"))
  await settle()

  const text = await frame()
  expect(text).toContain("a")
  expect(text).not.toContain("leftctrl")
})

test("kitty modifier events stay out of the embedded PTY while printable and control keys are re-encoded", async () => {
  const harness = createScriptedPtyRegistry()
  const { mockInput, frame } = await renderComponent(
    <Terminal cwd="/wt" taskId="kitty-wire" focused registry={harness.registry} />,
    { width: 60, height: 12, providers: { dialog: true } },
  )
  await frame()

  act(() => mockInput.pressKey("\x1b[57442;5u"))
  act(() => mockInput.pressKey("\x1b[97u"))
  act(() => mockInput.pressKey("\x1b[99;5u"))
  act(() => mockInput.pressKey("\x1b[57442;1:3u"))
  await settle()

  expect(harness.last().writeLog.join("")).toBe("a\x03")
})

test("kitty all-keys mode keeps bracketed paste as one paste event", async () => {
  const harness = createScriptedPtyRegistry()
  const { mockInput, frame } = await renderComponent(
    <Terminal cwd="/wt" taskId="kitty-paste" focused registry={harness.registry} />,
    { width: 60, height: 12, providers: { dialog: true } },
  )
  await frame()

  act(() => mockInput.pressKey("\x1b[200~first line\rsecond line\x1b[201~"))
  await settle()

  const pty = harness.last()
  expect(pty.pastes).toEqual(["first line\rsecond line"])
  expect(pty.writeLog.join("")).not.toContain("\r")
})
