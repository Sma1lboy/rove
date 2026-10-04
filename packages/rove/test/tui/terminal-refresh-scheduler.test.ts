import { describe, expect, it } from "vitest"
import type { TerminalRefreshScheduler, TerminalRow } from "../../src/tui/panes/terminal/pty-types"
import { FakeTransportPty, rowsText } from "./pty-fake"

function frameQueue() {
  const pending = new Set<() => void>()
  const schedule: TerminalRefreshScheduler = (refresh) => {
    pending.add(refresh)
    return () => pending.delete(refresh)
  }
  return {
    pending,
    schedule,
    frame() {
      const batch = [...pending]
      pending.clear()
      for (const refresh of batch) refresh()
    },
  }
}

describe("renderer-scheduled terminal snapshots", () => {
  it("coalesces all parsed output into the requested frame", async () => {
    const clock = frameQueue()
    const pty = new FakeTransportPty({ taskId: "frame", cwd: "/wt", scheduleRefresh: clock.schedule })
    const published: string[] = []
    pty.onData((rows) => published.push(rowsText(rows)))
    try {
      await pty.pump("first")
      await pty.pump(" second")
      expect(published).toHaveLength(0)
      expect(clock.pending.size).toBe(1)
      clock.frame()
      expect(published).toHaveLength(1)
      expect(published[0]).toContain("first second")
      expect(clock.pending.size).toBe(0)
      await pty.pump(" third")
      expect(clock.pending.size).toBe(1)
      clock.frame()
      expect(published).toHaveLength(2)
    } finally {
      pty.kill()
    }
  })

  it("cancels hidden and killed work while keeping the latest screen on reattach", async () => {
    const clock = frameQueue()
    const pty = new FakeTransportPty({ taskId: "hidden", cwd: "/wt", scheduleRefresh: clock.schedule })
    const off = pty.onData(() => {})
    try {
      await pty.pump("before detach")
      off()
      expect(clock.pending.size).toBe(0)
      await pty.pump(" and hidden output")
      expect(clock.pending.size).toBe(0)
      let screen: readonly TerminalRow[] = []
      pty.onData((rows) => {
        screen = rows
      })
      expect(rowsText(screen)).toContain("before detach and hidden output")
      await pty.pump(" queued")
      expect(clock.pending.size).toBe(1)
      pty.kill()
      expect(clock.pending.size).toBe(0)
      clock.frame()
      expect(rowsText(screen)).not.toContain("queued")
    } finally {
      pty.kill()
    }
  })

  it("capture consumes pending work and synchronized updates retry on another frame", async () => {
    const clock = frameQueue()
    const pty = new FakeTransportPty({ taskId: "sync", cwd: "/wt", scheduleRefresh: clock.schedule })
    const published: string[] = []
    pty.onData((rows) => published.push(rowsText(rows)))
    try {
      await pty.pump("old")
      expect(rowsText(pty.capture())).toContain("old")
      expect(clock.pending.size).toBe(0)
      await pty.pump("\x1b[?2026h\rnew")
      clock.frame()
      expect(published).toHaveLength(1)
      expect(clock.pending.size).toBe(1)
      await pty.pump("\x1b[?2026l")
      clock.frame()
      expect(published.at(-1)).toContain("new")
    } finally {
      pty.kill()
    }
  })
})
