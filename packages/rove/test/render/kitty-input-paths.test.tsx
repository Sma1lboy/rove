/** @jsxImportSource @opentui/react */

import { expect, test } from "bun:test"
import { useState } from "react"
import { useBindings } from "../../src/tui-react/lib/keymap"
import { Terminal } from "../../src/tui-react/panes/terminal/Terminal"
import { type ScriptedPtyRegistry, createScriptedPtyRegistry } from "../../src/tui/panes/terminal/pty-scripted"
import { act, renderComponent, settle } from "./harness"

/**
 * Wait until `<Terminal>` holds a pty and has attached to it.
 *
 * One `await frame()` flushes a render pass, which is not the same thing: the
 * acquire happens in a mount effect and the pane only holds the pty a render
 * later, so on a loaded machine keys sent right after the acquire hit a pane
 * with no pty and vanish. Attachment (the pane's data subscription) comes after
 * that render.
 */
async function acquiredPty(harness: ScriptedPtyRegistry) {
  await until(() => harness.ptys.at(-1)?.attached === true, "no pty attached")
  return harness.last()
}

/** Poll `done` until it holds; throws `message` after `timeoutMs`. */
async function until(done: () => boolean, message: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!done()) {
    if (Date.now() >= deadline) throw new Error(`${message} within ${timeoutMs}ms`)
    await settle(10)
  }
}

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

test("kitty modifier, text, keypad, and navigation events are re-encoded for the embedded PTY", async () => {
  const harness = createScriptedPtyRegistry()
  const { mockInput } = await renderComponent(
    <Terminal cwd="/wt" taskId="kitty-wire" focused registry={harness.registry} />,
    { width: 60, height: 12, providers: { dialog: true } },
  )
  await acquiredPty(harness)

  const wireEvents = [
    "\x1b[57442;5u",
    "\x1b[97u",
    "\x1b[99;5u",
    "\x1b[128512u",
    "\x1b[131072u",
    "\x1b[57414u",
    "\x1b[57417u",
    "\x1b[57418u",
    "\x1b[57419u",
    "\x1b[57420u",
    "\x1b[57421u",
    "\x1b[57422u",
    "\x1b[57423u",
    "\x1b[57424u",
    "\x1b[57425u",
    "\x1b[57426u",
    "\x1b[57348u",
    "\x1b[57354u",
    "\x1b[57355u",
    "\x1b[57369u",
    "\x1b[57371u",
    "\x1b[57372u",
    "\x1b[57373u",
    "\x1b[57374u",
    "\x1b[57375u",
    "\x1b[1;1:1A",
    "\x1b[57442;1:3u",
  ]
  act(() => mockInput.pressKey(wireEvents.join("")))

  const expected =
    "a\x03😀𠀀\r\x1b[D\x1b[C\x1b[A\x1b[B\x1b[5~\x1b[6~\x1b[H\x1b[F\x1b[2~\x1b[3~" +
    "\x1b[2~\x1b[5~\x1b[6~\x1b[17~\x1b[19~\x1b[20~\x1b[21~\x1b[23~\x1b[24~\x1b[A"
  await until(() => harness.last().writeLog.join("") === expected, "PTY writes did not match", 4_000).catch(() => {})
  expect(harness.last().writeLog.join("")).toBe(expected)
})

test("kitty navigation follows the child PTY application cursor and keypad modes", async () => {
  const harness = createScriptedPtyRegistry()
  const { mockInput } = await renderComponent(
    <Terminal cwd="/wt" taskId="kitty-application-modes" focused registry={harness.registry} />,
    { width: 60, height: 12, providers: { dialog: true } },
  )
  ;(await acquiredPty(harness)).modes = { applicationCursorKeys: true, applicationKeypad: true }
  act(() => {
    mockInput.pressKey("\x1b[1;1:1A")
    mockInput.pressKey("\x1b[1;1:1H")
    mockInput.pressKey("\x1b[57414u")
  })
  await settle()
  expect(harness.last().writeLog.join("")).toBe("\x1bOA\x1bOH\x1bOM")

  harness.last().modes = { applicationCursorKeys: false, applicationKeypad: false }
  act(() => {
    mockInput.pressKey("\x1b[1;1:1A")
    mockInput.pressKey("\x1b[1;1:1H")
    mockInput.pressKey("\x1b[57414u")
  })
  await settle()
  expect(harness.last().writeLog.join("")).toBe("\x1bOA\x1bOH\x1bOM\x1b[A\x1b[H\r")
})
