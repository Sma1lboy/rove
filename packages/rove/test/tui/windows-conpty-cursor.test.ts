import { Terminal } from "@xterm/headless"
import { afterEach, describe, expect, it, vi } from "vitest"
import { XtermSnapshotEngine, type XtermSnapshotRefreshResult } from "../../src/tui/panes/terminal/pty-xterm-snapshot"
import { XtermRefreshTracker } from "../../src/tui/panes/terminal/xterm-refresh"
import { FakeTransportPty } from "./pty-fake"

// Sanitized from the reporter's ConPTY stream: frame end and cursor repair
// arrived in different reads. The frame itself is complete, not truncated.
const WORKING_FRAME = "\x1b[?2026h\x1b[?25l\x1b[34;1HWorking\x1b[33;1H\x1b[?25h\x1b[0 q\x1b[?2026l"
const CURSOR_REPAIR = "\x1b[?25l \x1b[37;3H\x1b[?25h"

afterEach(() => vi.restoreAllMocks())

async function fixture(platform: NodeJS.Platform = "win32") {
  const term = new Terminal({ cols: 80, rows: 40, allowProposedApi: true })
  const tracker = new XtermRefreshTracker(term)
  const engine = new XtermSnapshotEngine(undefined, platform)
  let now = 1000
  vi.spyOn(Date, "now").mockImplementation(() => now)
  let state: XtermSnapshotRefreshResult = {
    snapshot: [],
    cursor: null,
    snapshotWindow: null,
    wrapped: [],
    changed: false,
    cursorPending: false,
  }
  const refresh = () => {
    state = engine.refresh(term, 40, 0, tracker, state.snapshot, state.cursor, state.snapshotWindow) ?? state
    return state
  }
  const pump = async (data: string) => {
    await new Promise<void>((resolve) => term.write(data, resolve))
    return refresh()
  }
  await pump("\x1b[34;1HIdle\x1b[37;1H> draft\x1b[37;3H\x1b[?25h")
  return {
    pump,
    advance(ms: number) {
      now += ms
      return refresh()
    },
    close() {
      tracker.dispose()
      term.dispose()
    },
  }
}

describe("Windows cursor repair after synchronized output", () => {
  it.skipIf(process.platform !== "win32")("publishes a genuine new row even when output stops", async () => {
    const pty = new FakeTransportPty({ taskId: "quiet-cursor", cwd: ".", cols: 80, rows: 40 })
    let publishedCursor: { x: number; y: number } | null = null
    try {
      await pty.pump("\x1b[37;1H> draft\x1b[37;3H\x1b[?25h")
      pty.capture()
      const off = pty.onData(() => {
        publishedCursor = pty.captureCursor()
      })
      try {
        await pty.pump(WORKING_FRAME)
        await vi.waitFor(() => expect(publishedCursor).toEqual({ x: 0, y: 32 }))
      } finally {
        off()
      }
    } finally {
      pty.kill()
    }
  })

  it("paints a completed Working frame without publishing its temporary cursor row", async () => {
    const f = await fixture()
    try {
      const frame = await f.pump(WORKING_FRAME)
      expect(frame.cursor).toEqual({ x: 2, y: 36 })
      expect(frame.snapshot[33]?.map((c) => c.text).join("")).toContain("Working")
      expect(frame.cursorPending).toBe(true)
      f.advance(31)
      const repaired = await f.pump(CURSOR_REPAIR)
      expect(repaired.cursor).toEqual({ x: 2, y: 36 })
      expect(repaired.cursorPending).toBe(false)
    } finally {
      f.close()
    }
  })

  it("does not restart the deadline when a genuine new cursor row keeps repainting", async () => {
    const f = await fixture()
    try {
      await f.pump(WORKING_FRAME)
      f.advance(40)
      await f.pump(WORKING_FRAME)
      const settled = f.advance(40)
      expect(settled.cursor).toEqual({ x: 0, y: 32 })
      expect(settled.cursorPending).toBe(false)
    } finally {
      f.close()
    }
  })

  it("does not retain a cursor over a row replaced by output", async () => {
    const f = await fixture()
    try {
      const frame = await f.pump(`\x1b[37;1Hnew output${WORKING_FRAME}`)
      expect(frame.cursor).toBeNull()
      expect(f.advance(80).cursor).toEqual({ x: 0, y: 32 })
    } finally {
      f.close()
    }
  })

  it.each(["darwin", "linux"] as const)("preserves immediate frame cursor updates on %s", async (platform) => {
    const f = await fixture(platform)
    try {
      expect((await f.pump(WORKING_FRAME)).cursor).toEqual({ x: 0, y: 32 })
    } finally {
      f.close()
    }
  })

  it("updates horizontal typing and unframed navigation immediately", async () => {
    const f = await fixture()
    try {
      const typed = await f.pump("\x1b[?2026h\x1b[37;5H\x1b[?2026l")
      expect(typed.cursor).toEqual({ x: 4, y: 36 })
      expect(typed.cursorPending).toBe(false)
      expect((await f.pump("\x1b[36;5H")).cursor).toEqual({ x: 4, y: 35 })
    } finally {
      f.close()
    }
  })
})
