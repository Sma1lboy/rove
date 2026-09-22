import { expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { createRoot } from "@opentui/react"
import { act, useEffect, useState } from "react"
import { terminalFrameScheduler } from "../../src/tui-react/panes/terminal/terminal-frame-scheduler"
import type { TerminalRow } from "../../src/tui/panes/terminal/pty-types"
import { FakeTransportPty, rowsText } from "../tui/pty-fake"

test("PTY data reaches the actual frame that requested its snapshot", async () => {
  let pty: FakeTransportPty | null = null
  function Screen() {
    const [rows, setRows] = useState<readonly TerminalRow[]>([])
    useEffect(() => pty?.onData(setRows), [])
    return <text>{rowsText(rows)}</text>
  }
  const t = await createTestRenderer({ width: 40, height: 4 })
  pty = new FakeTransportPty({
    taskId: "frame",
    cwd: "/wt",
    scheduleRefresh: terminalFrameScheduler(t.renderer),
  })
  const root = createRoot(t.renderer)
  try {
    await act(async () => {
      root.render(<Screen />)
    })
    await t.renderOnce()
    // Automatic draws stay suspended; one explicit pass is the assertion.
    t.renderer.suspend()
    await pty.pump("first")
    await pty.pump(" latest")
    expect(t.captureCharFrame()).not.toContain("first latest")
    await t.renderOnce()
    expect(t.captureCharFrame()).toContain("first latest")
    await pty.pump("\rshort\x1b[K")
    await t.renderOnce()
    expect(t.captureCharFrame()).toContain("short")
    expect(t.captureCharFrame()).not.toContain("latest")
  } finally {
    pty.kill()
    act(() => root.unmount())
    t.renderer.destroy()
  }
})
