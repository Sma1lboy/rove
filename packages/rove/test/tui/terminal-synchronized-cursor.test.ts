import { describe, expect, it, vi } from "vitest"
import { FakeTransportPty, settleRefresh } from "./pty-fake"

describe("terminal cursor during synchronized output", () => {
  it("keeps the published cursor until a cursor-only frame completes", async () => {
    const pty = new FakeTransportPty({ taskId: "sync-cursor", cwd: ".", cols: 80, rows: 24 })
    try {
      await pty.pump("\x1b[3;1HWorking\x1b[5;1H> prompt\x1b[5;9H\x1b[?25h")
      const snapshot = pty.capture()
      expect(pty.captureCursor()).toEqual({ x: 8, y: 4 })

      await pty.pump("\x1b[?2026h\x1b[3;1H")
      expect(pty.capture()).toBe(snapshot)
      expect(pty.captureCursor()).toEqual({ x: 8, y: 4 })

      await pty.pump("\x1b[5;4H\x1b[?2026l")
      expect(pty.captureCursor()).toEqual({ x: 3, y: 4 })
    } finally {
      pty.kill()
    }
  })

  it("does not notify the visible pane about an unfinished cursor move", async () => {
    const pty = new FakeTransportPty({ taskId: "visible-sync-cursor", cwd: ".", cols: 80, rows: 24 })
    const onData = vi.fn()
    const off = pty.onData(onData)
    try {
      await pty.pump("\x1b[3;1HWorking\x1b[5;1H> prompt\x1b[5;9H\x1b[?25h")
      await settleRefresh()
      onData.mockClear()

      await pty.pump("\x1b[?2026h\x1b[3;1H")
      await settleRefresh()
      expect(onData).not.toHaveBeenCalled()

      await pty.pump("\x1b[5;4H\x1b[?2026l")
      await settleRefresh()
      expect(onData).toHaveBeenCalledTimes(1)
      expect(pty.captureCursor()).toEqual({ x: 3, y: 4 })
    } finally {
      off()
      pty.kill()
    }
  })
})
