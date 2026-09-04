/**
 * The PTY snapshot coalesce window must stay pinned to the renderer's frame
 * period. Nothing else checks this: the constant and `targetFps` live in
 * different layers, and drift between them is silent — too small and every
 * extra snapshot is built, committed and laid out for a frame that is never
 * drawn (the state this test was written to stop returning to); too large and
 * terminal output visibly lags the renderer.
 *
 * `targetFps` is read off a LIVE renderer rather than asserted as a literal,
 * so an opentui default change fails here instead of quietly re-inflating the
 * streaming path.
 */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/react/test-utils"
import { SNAPSHOT_COALESCE_MS } from "../../src/tui/panes/terminal/pty-xterm-base"

test("snapshot coalesce window matches the renderer's frame period", async () => {
  const t = await testRender(
    <box>
      <text>fps</text>
    </box>,
    { width: 20, height: 5 },
  )
  const targetFps = (t.renderer as unknown as { targetFps: number }).targetFps
  expect(targetFps).toBeGreaterThan(0)
  // Round, not equal: 1000/30 is 33.33 and the timer takes whole ms.
  expect(SNAPSHOT_COALESCE_MS).toBe(Math.round(1000 / targetFps))
  await (t as unknown as { destroy?: () => Promise<void> }).destroy?.()
})
