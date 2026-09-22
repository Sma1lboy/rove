/** Verify the runtime frame settings against a real renderer. */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/react/test-utils"
import { hostRenderOptions, hostTargetFps } from "../../src/tui/lib/host-render-options"
import { SNAPSHOT_COALESCE_MS } from "../../src/tui/panes/terminal/pty-xterm-base"

test("non-visual snapshot fallback uses the host's frame period", async () => {
  const fps = hostTargetFps()
  expect(fps).toBeGreaterThan(0)
  expect(hostRenderOptions().targetFps).toBe(fps)
  // Round, not equal: 1000/30 is 33.33 and the timer takes whole ms.
  expect(SNAPSHOT_COALESCE_MS).toBe(Math.round(1000 / fps))

  const t = await testRender(
    <box>
      <text>fps</text>
    </box>,
    { ...hostRenderOptions(), width: 20, height: 5 },
  )
  try {
    expect(t.renderer.targetFps).toBe(fps)
  } finally {
    t.renderer.destroy()
  }
})
