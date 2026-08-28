/** @jsxImportSource @opentui/react */

import { expect, test } from "bun:test"
import { Terminal } from "../../src/tui-react/panes/terminal/Terminal"
import { createScriptedPtyRegistry } from "../../src/tui/panes/terminal/pty-scripted"
import { ATTR } from "../../src/tui/panes/terminal/sgr"
import { type RenderHandle, act, renderComponent } from "./harness"

/** A pane fed `content`, its first visible row at screen y=2 (body: 16 rows). */
const mountPane = async (
  taskId: string,
  content = Array.from({ length: 80 }, (_, i) => `line-${i + 1}`).join("\r\n"),
): Promise<[RenderHandle, ReturnType<typeof createScriptedPtyRegistry>]> => {
  const harness = createScriptedPtyRegistry()
  let handle: RenderHandle | undefined
  await act(async () => {
    handle = await renderComponent(
      // Two spacer rows stand in for the workspace tab strip above the pane.
      <box flexDirection="column" height={18}>
        <box height={2}>
          <text>spacer</text>
        </box>
        <Terminal cwd="/wt" taskId={taskId} focused registry={harness.registry} />
      </box>,
      { width: 60, height: 18, providers: { dialog: true } },
    )
  })
  if (!handle) throw new Error("terminal mount failed")
  const mounted = handle
  await act(async () => {
    harness.last().feed(content)
    await mounted.frame()
  })
  return [mounted, harness]
}

const settle = async (handle: RenderHandle, ms: number): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
    await handle.frame()
  })
}

/**
 * A selection drag held at the pane's FIRST VISIBLE ROW must pull the viewport
 * into scrollback. The boundary row is the gesture that matters: in the real
 * workspace the pane sits flush under a one-row tab strip, so "drag above the
 * pane" is a target the pointer rarely hits.
 *
 * Neither test RELEASES the drag: mouse-up copies the selection, and that
 * writes to the real system clipboard.
 */
test("a selection drag held at the pane's top row scrolls into scrollback", async () => {
  const [handle] = await mountPane("drag-autoscroll")
  try {
    expect(await handle.frame()).toContain("line-80")

    // Press inside the pane, drag up through it, and hold on its first
    // visible row. The pointer never leaves the pane.
    await act(async () => {
      await handle.mockMouse.pressDown(20, 12)
      await handle.mockMouse.emitMouseEvent("drag", 20, 6)
      await handle.mockMouse.emitMouseEvent("drag", 20, 2)
      await handle.frame()
    })
    await settle(handle, 250)

    // The scrollback affordance only draws once the viewport has left the live
    // bottom — i.e. the held drag reached history the pointer alone couldn't.
    expect(await handle.frame()).toMatch(/scrolled|已回滚/)

    // Away from the edge, the viewport must stop moving on its own.
    await act(async () => {
      await handle.mockMouse.emitMouseEvent("drag", 20, 6)
      await handle.frame()
    })
    const stopped = await handle.frame()
    await settle(handle, 250)
    expect(await handle.frame()).toBe(stopped)
  } finally {
    handle.destroy()
  }
})

/**
 * The gesture that actually breaks: the drag's FIRST move already lands outside
 * the pane (a fast flick, or a press on the top row heading up into the tab
 * strip). opentui starts capturing a drag on that first event by hit test, so
 * without an explicit capture on press the pane never sees the drag at all.
 */
test("a drag that leaves the pane on its first move still scrolls", async () => {
  const [handle] = await mountPane("drag-first-move-out")
  try {
    await act(async () => {
      await handle.mockMouse.pressDown(20, 2)
      await handle.mockMouse.emitMouseEvent("drag", 20, 0)
      await handle.frame()
    })
    await settle(handle, 250)
    expect(await handle.frame()).toMatch(/scrolled|已回滚/)
  } finally {
    handle.destroy()
  }
})

/** The pull is directional: a sideways drag along the top row is not "up". */
test("dragging sideways along the top row does not scroll", async () => {
  const [handle] = await mountPane("drag-sideways")
  try {
    await act(async () => {
      await handle.mockMouse.pressDown(10, 2)
      await handle.mockMouse.emitMouseEvent("drag", 20, 2)
      await handle.mockMouse.emitMouseEvent("drag", 30, 2)
      await handle.frame()
    })
    await settle(handle, 250)
    expect(await handle.frame()).not.toMatch(/scrolled|已回滚/)
  } finally {
    handle.destroy()
  }
})

/**
 * An app that owns its own scrollback — an engine on the ALTERNATE screen,
 * where the pane has no local history to move — must be scrolled the way the
 * wheel scrolls it: by forwarding wheel ticks, not by moving a viewport that
 * cannot move. Claude Code is exactly this case, so without it a drag-select
 * at the edge of an engine tab does nothing at all.
 *
 * And forwarding alone is not the fix (issue #54): the app scrolls, the
 * content shifts, but the snapshot row numbers stay put — so the SELECTION
 * must follow the measured content shift, not stay a screen-fixed rectangle.
 * The drag here is held at the edge while the scripted app scrolls itself;
 * the highlight must keep growing over the rows scrolling in from the top.
 */
test("a drag held at the edge scrolls an app that owns its own scrollback", async () => {
  // A 16-row alternate screen over an 80-line document, scrolled to the
  // bottom: exactly an engine tab's snapshot shape (one screen, no history).
  const doc = Array.from({ length: 80 }, (_, i) => `line-${i + 1}`)
  let top = 64
  const [handle, harness] = await mountPane("drag-forwards-wheel", doc.slice(top, top + 16).join("\n"))
  const wheels: string[] = []
  const pty = harness.last()
  pty.wheel = (direction: "up" | "down"): boolean => {
    wheels.push(direction)
    // The scripted app scrolls itself: full-screen repaint one line over.
    top = direction === "up" ? Math.max(0, top - 1) : Math.min(64, top + 1)
    pty.replaceScreen(doc.slice(top, top + 16).join("\n"))
    return true
  }
  const highlightedLines = async (): Promise<string[]> => {
    const frame = await handle.spans()
    return frame.lines
      .filter((line) => line.spans.some((s) => (s.attributes & ATTR.INVERSE) !== 0))
      .map((line) =>
        line.spans
          .map((s) => s.text)
          .join("")
          .trim(),
      )
  }
  try {
    // Press on line-75 (body row 10), drag up to the edge row and hold.
    await act(async () => {
      await handle.mockMouse.pressDown(20, 12)
      await handle.mockMouse.emitMouseEvent("drag", 20, 2)
      await handle.frame()
    })
    await settle(handle, 250)
    expect(wheels.length).toBeGreaterThan(0)
    expect(wheels.every((d) => d === "up")).toBe(true)
    // The app scrolls itself; the pane's own viewport must stay put.
    expect(await handle.frame()).not.toMatch(/scrolled|已回滚/)
    expect(top).toBeLessThan(64)

    // The selection followed the content: rows scrolled in from the top are
    // highlighted (the selection GREW past the 11 rows the press-to-edge drag
    // covered on its own — head row 0 to anchor row 10), and the anchor row's
    // content stayed selected as it moved down the screen.
    const after = await highlightedLines()
    expect(after.length).toBeGreaterThan(11)
    expect(after[0]).toBe(`line-${top + 1}`) // head still pinned at the top edge
    const anchorRow = after.indexOf("line-75")
    expect(anchorRow === -1 || anchorRow > 10).toBe(true) // moved down (or off) with the content
  } finally {
    handle.destroy()
  }
})
