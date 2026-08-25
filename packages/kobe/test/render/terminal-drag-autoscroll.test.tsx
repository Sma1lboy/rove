/** @jsxImportSource @opentui/react */

import { expect, test } from "bun:test"
import { Terminal } from "../../src/tui-react/panes/terminal/Terminal"
import { createScriptedPtyRegistry } from "../../src/tui/panes/terminal/pty-scripted"
import { type RenderHandle, act, renderComponent } from "./harness"

const settle = async (handle: RenderHandle, ms: number): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
    await handle.frame()
  })
}

/**
 * A selection drag that hangs above the pane must pull the viewport into
 * scrollback — the pointer can't travel far past an edge that sits near the
 * top of the screen, so without auto-scroll every row above the first visible
 * one is unreachable. Two spacer rows give the drag somewhere to hang.
 *
 * The test never RELEASES the drag: mouse-up copies the selection, and that
 * writes to the real system clipboard.
 */
test("a selection drag hanging above the pane scrolls into scrollback", async () => {
  const harness = createScriptedPtyRegistry()
  let handle: RenderHandle | undefined
  await act(async () => {
    handle = await renderComponent(
      <box flexDirection="column" height={18}>
        <box height={2}>
          <text>spacer</text>
        </box>
        <Terminal cwd="/wt" taskId="drag-autoscroll" focused registry={harness.registry} />
      </box>,
      { width: 60, height: 18, providers: { dialog: true } },
    )
  })
  if (!handle) throw new Error("terminal mount failed")
  try {
    await act(async () => {
      harness.last().feed(Array.from({ length: 80 }, (_, i) => `line-${i + 1}`).join("\r\n"))
      await handle?.frame()
    })
    expect(await handle.frame()).toContain("line-80")

    // Press inside the pane, drag up to a row still inside it (that is what
    // captures the drag), then hang two rows above the pane's top edge.
    await act(async () => {
      await handle?.mockMouse.pressDown(20, 12)
      await handle?.mockMouse.emitMouseEvent("drag", 20, 6)
      await handle?.mockMouse.emitMouseEvent("drag", 20, 0)
      await handle?.frame()
    })
    await settle(handle, 250)

    // The scrollback affordance only draws once the viewport has left the live
    // bottom — i.e. the hanging drag reached history that pointer travel alone
    // could never have reached.
    expect(await handle.frame()).toMatch(/scrolled|已回滚/)

    // Back inside the pane, the viewport must stop moving on its own.
    await act(async () => {
      await handle?.mockMouse.emitMouseEvent("drag", 20, 6)
      await handle?.frame()
    })
    const stopped = await handle.frame()
    await settle(handle, 250)
    expect(await handle.frame()).toBe(stopped)
  } finally {
    handle.destroy()
  }
})
