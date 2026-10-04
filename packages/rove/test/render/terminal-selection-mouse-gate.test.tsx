/** @jsxImportSource @opentui/react */
/**
 * The pane's own selection yields the screen to an app that owns the mouse.
 *
 * The press-time gate already keeps the pane out of a mouse-aware app: the
 * click is forwarded and no selection starts. What it cannot cover is the app
 * arriving AFTER the selection: `vim` typed at a prompt where text is still
 * highlighted, or launched mid-drag. Both highlights then paint on the same
 * screen and the app cannot see (or clear) the pane's.
 *
 * The measurement is the highlight itself — cells carrying the selection
 * background — compared against a CONTROL pane that reaches the identical
 * final screen without ever selecting. Comparing to a control rather than to
 * zero keeps the assertion honest about the cursor cell, which comes back the
 * moment the selection is gone.
 */

import { expect, test } from "bun:test"
import type { CapturedFrame } from "@opentui/core"
import { Terminal } from "../../src/tui-react/panes/terminal/Terminal"
import { createScriptedPtyRegistry } from "../../src/tui/panes/terminal/pty-scripted"
import { type RenderHandle, act, renderComponent } from "./harness"

/** The theme's resolved selection/inverse background. */
const SELECTION_BG = [234, 231, 223] as const
const PROMPT_SCREEN = Array.from({ length: 12 }, (_, i) => `line-${i + 1}`).join("\r\n")
/** What a mouse-aware app repaints the pane with when it takes over. */
const APP_SCREEN = "VIM SCREEN\r\nrow2\r\nrow3\r\nrow4"

const highlightedCells = (frame: CapturedFrame): number => {
  let cells = 0
  for (const line of frame.lines) {
    for (const span of line.spans) {
      const [r, g, b] = span.bg.toInts()
      if (r === SELECTION_BG[0] && g === SELECTION_BG[1] && b === SELECTION_BG[2]) cells += span.width
    }
  }
  return cells
}

const mountPane = async (taskId: string) => {
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
    harness.last().feed(PROMPT_SCREEN)
    await mounted.frame()
  })
  return { handle: mounted, harness }
}

/** The app enables mouse tracking and repaints, the way entering vim does. */
const appTakesOver = async (
  handle: RenderHandle,
  harness: Awaited<ReturnType<typeof mountPane>>["harness"],
): Promise<number> => {
  harness.last().appOwnsMouse = true
  await act(async () => {
    harness.last().replaceScreen(APP_SCREEN)
    await handle.frame()
  })
  return highlightedCells(await settled(handle))
}

/**
 * The render carrying a just-changed selection commits when `act` EXITS, so a
 * frame captured inside the same block is always one render behind.
 */
const settled = async (handle: RenderHandle): Promise<CapturedFrame> => {
  await act(async () => {
    await handle.frame()
  })
  return handle.spans()
}

/**
 * Neither drag RELEASES: mouse-up copies the selection, and that writes to the
 * real system clipboard.
 */
test("a selection is cleared when the app takes the mouse under it", async () => {
  const control = await mountPane("gate-control")
  const dragged = await mountPane("gate-dragged")
  try {
    await act(async () => {
      await dragged.handle.mockMouse.pressDown(2, 4)
      await dragged.handle.mockMouse.emitMouseEvent("drag", 40, 6)
    })
    const selected = highlightedCells(await settled(dragged.handle))
    const baseline = highlightedCells(await settled(control.handle))
    // The drag really did paint a highlight — otherwise the assertion below
    // would pass on a pane that never selected anything.
    expect(selected).toBeGreaterThan(baseline)

    // The app takes the mouse and repaints. Both panes now show the same
    // screen, so any remaining difference is the pane's stale highlight.
    expect(await appTakesOver(dragged.handle, dragged.harness)).toBe(
      await appTakesOver(control.handle, control.harness),
    )
  } finally {
    dragged.handle.destroy()
    control.handle.destroy()
  }
})

/**
 * The shift bypass (the iTerm/kitty escape hatch) is how text still gets
 * pulled out of a mouse-aware app, so a selection begun while the app ALREADY
 * owned the mouse is a deliberate override — it keeps its highlight.
 */
test("a shift-drag inside a mouse-aware app keeps its highlight", async () => {
  const { handle, harness } = await mountPane("gate-shift")
  try {
    harness.last().appOwnsMouse = true
    await act(async () => {
      harness.last().replaceScreen(APP_SCREEN)
      await handle.frame()
    })
    const baseline = highlightedCells(await settled(handle))

    await act(async () => {
      await handle.mockMouse.pressDown(2, 3, 0, { modifiers: { shift: true } })
      await handle.mockMouse.emitMouseEvent("drag", 40, 4, 0, { modifiers: { shift: true } })
    })
    expect(highlightedCells(await settled(handle))).toBeGreaterThan(baseline)
  } finally {
    handle.destroy()
  }
})
