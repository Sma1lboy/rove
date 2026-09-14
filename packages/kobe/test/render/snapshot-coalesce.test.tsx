/**
 * The PTY snapshot coalesce window must stay pinned to the renderer's frame
 * period. Nothing else checks this: the constant and `targetFps` live in
 * different layers, and drift between them is silent — too small and every
 * extra snapshot is built, committed and laid out for a frame that is never
 * drawn (the state this test was written to stop returning to); too large and
 * terminal output visibly lags the renderer.
 *
 * Both now derive from `hostTargetFps()`; this test checks that the value the
 * renderer is actually configured with (`hostRenderOptions().targetFps`) is
 * the one the coalesce window was computed from, and — off Windows, where the
 * cadence is opentui's own default — that a LIVE renderer still reports it,
 * so an opentui default change fails here instead of quietly re-inflating the
 * streaming path.
 */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/react/test-utils"
import { hostRenderOptions, hostTargetFps } from "../../src/tui/lib/host-render-options"
import { SNAPSHOT_COALESCE_MS } from "../../src/tui/panes/terminal/pty-xterm-base"

test("snapshot coalesce window matches the renderer's frame period", async () => {
  const fps = hostTargetFps()
  expect(fps).toBeGreaterThan(0)
  expect(hostRenderOptions().targetFps).toBe(fps)
  // Round, not equal: 1000/30 is 33.33 and the timer takes whole ms.
  expect(SNAPSHOT_COALESCE_MS).toBe(Math.round(1000 / fps))

  const t = await testRender(
    <box>
      <text>fps</text>
    </box>,
    { width: 20, height: 5 },
  )
  const liveFps = (t.renderer as unknown as { targetFps: number }).targetFps
  expect(liveFps).toBeGreaterThan(0)
  if (process.platform !== "win32") expect(liveFps).toBe(fps)
  await (t as unknown as { destroy?: () => Promise<void> }).destroy?.()
})

test("Windows renders at 60fps, everything else at opentui's 30", () => {
  expect(hostTargetFps("win32")).toBe(60)
  expect(hostTargetFps("darwin")).toBe(30)
  expect(hostTargetFps("linux")).toBe(30)
})
