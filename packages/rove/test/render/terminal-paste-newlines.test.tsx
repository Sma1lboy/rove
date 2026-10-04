/** @jsxImportSource @opentui/react */
/**
 * A pasted block with newlines must reach the engine as ONE paste, not as a
 * line of typing followed by Enter — otherwise the first line submits and the
 * rest lands wherever the engine went next. The host terminal only frames a
 * paste when bracketed-paste mode is on (`installBracketedPasteMode`); this
 * test drives the framed bytes through the real key parser and the real pane.
 */

import { expect, test } from "bun:test"
import { Terminal } from "../../src/tui-react/panes/terminal/Terminal"
import { createScriptedPtyRegistry } from "../../src/tui/panes/terminal/pty-scripted"
import { act, renderComponent, settle } from "./harness"

test("a multi-line paste is delivered as one paste, never as Enter", async () => {
  const harness = createScriptedPtyRegistry()
  const { mockInput, frame } = await renderComponent(
    <Terminal cwd="/wt" taskId="paste-newlines" focused registry={harness.registry} />,
    { width: 60, height: 12, providers: { dialog: true } },
  )
  await frame()

  // Exactly what a terminal sends for a two-line paste with the mode on.
  act(() => mockInput.pressKey("\x1b[200~first line\rsecond line\x1b[201~"))
  await settle()

  const pty = harness.last()
  expect(pty.pastes).toEqual(["first line\rsecond line"])
  // The carriage return stayed inside the paste: nothing was typed at all.
  expect(pty.writeLog.join("")).not.toContain("\r")
})
