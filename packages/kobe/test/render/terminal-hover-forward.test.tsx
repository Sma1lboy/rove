/** @jsxImportSource @opentui/react */
/**
 * Hover with no button held reaches the PTY app as pane-local motion, so an
 * any-motion (1003) app like claude can highlight the row under the pointer.
 */

import { expect, test } from "bun:test"
import { Terminal } from "../../src/tui-react/panes/terminal/Terminal"
import { createScriptedPtyRegistry } from "../../src/tui/panes/terminal/pty-scripted"
import { type RenderHandle, act, renderComponent } from "./harness"

test("hover over the pane is forwarded as pane-local motion", async () => {
  const harness = createScriptedPtyRegistry()
  let handle: RenderHandle | undefined
  await act(async () => {
    handle = await renderComponent(
      // Two spacer rows stand in for the workspace tab strip above the pane.
      <box flexDirection="column" height={18}>
        <box height={2}>
          <text>spacer</text>
        </box>
        <Terminal cwd="/wt" taskId="t1" focused registry={harness.registry} />
      </box>,
      { width: 60, height: 18, providers: { dialog: true } },
    )
  })
  if (!handle) throw new Error("terminal mount failed")
  const mounted = handle
  await act(async () => {
    harness.last().feed("a\r\nb\r\nc")
    await mounted.frame()
  })
  await act(async () => {
    await mounted.mockMouse.moveTo(10, 5)
    await mounted.frame()
  })

  expect(harness.last().clicks).toEqual([{ kind: "move", button: 0, col: 11, row: 4 }])
})
