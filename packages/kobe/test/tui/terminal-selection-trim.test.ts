import { describe, expect, it, vi } from "vitest"
import type { TerminalRow, TerminalSnapshotWindow } from "../../src/tui/panes/terminal/pty-types"
import { XtermTaskPty } from "../../src/tui/panes/terminal/pty-xterm-base"
import {
  EMPTY_SHADOW,
  type SelectionRange,
  extractSelection,
  followWindowShift,
} from "../../src/tui/panes/terminal/terminal-selection"

/**
 * The bug this pins, through the REAL snapshot pipeline (xterm → snapshot
 * engine → published window), not a hand-built fixture:
 *
 * The pane addresses a selection by snapshot ARRAY INDEX. Once the local
 * scrollback saturates, every new line drops one row off the front of that
 * array, so the same index addresses content one line newer — the highlight
 * drifts downward relative to what the user selected, by exactly the number of
 * rows dropped. The viewport already compensates (`resolveViewportScrollOffset`
 * re-derives its offset from the published `startLine`); the selection did not.
 *
 * This is NOT the alternate-screen `snapshotShift` case: there the app owns the
 * scrollback and the displacement has to be read back off the content. Here the
 * PTY publishes the exact line id, so the correction is arithmetic.
 */

class FakeTransportPty extends XtermTaskPty {
  protected transportWrite(): void {}
  protected transportResize(): void {}
  protected transportKill(): void {}
  pump(data: string): void {
    this.feed(data)
  }
}

const COLS = 40
const ROWS = 10
const SCROLLBACK = 50

/**
 * Wait for the backend to publish, rather than sleeping and hoping.
 *
 * `queueRefresh` coalesces on a 16ms timer, so the state this test asserts on
 * lands some unknowable time after the last `pump`. A fixed sleep was racing
 * that timer: on a loaded CI runner it returned early and the test failed on
 * whatever half-built frame it found — `expected null not to be null` when no
 * window had been published yet, `expected 16 to be 10` when only part of the
 * output had been folded in. Both were read as flakes; both were this.
 */
const settleUntil = (check: () => void): Promise<void> => vi.waitFor(check, { timeout: 5000, interval: 10 })

type Frame = { snapshot: readonly TerminalRow[]; window: TerminalSnapshotWindow | null }

describe("selection across a bounded-scrollback trim", () => {
  it("keeps the highlight on the content it selected while output streams", async () => {
    const pty = new FakeTransportPty({ taskId: "t1", cwd: "/wt", cols: COLS, rows: ROWS, scrollback: SCROLLBACK })
    // A subscriber is what makes the backend refresh at output cadence.
    const unsubscribe = pty.onData(() => {})
    try {
      for (let i = 0; i < 200; i++) pty.pump(`line-${i}\r\n`)
      // The buffer is saturated: the backend numbers lines, and row 0 is no
      // longer line-0. Both are preconditions for the drift, so WAIT for them
      // rather than assert against whatever a fixed sleep happened to catch.
      await settleUntil(() => {
        expect(pty.captureWindow()).not.toBeNull()
        expect(pty.capture().length).toBe(ROWS + SCROLLBACK)
      })
      const before: Frame = { snapshot: pty.capture(), window: pty.captureWindow() }

      // Select two whole rows in the frozen scrollback, far enough down that
      // the coming trim moves them rather than dropping them entirely.
      const selected = { anchor: { row: 20, col: 0 }, head: { row: 21, col: 7 } } satisfies SelectionRange
      const text = extractSelection(before.snapshot, selected)
      expect(text).toMatch(/^line-\d+\nline-\d+$/)

      for (let i = 200; i < 210; i++) pty.pump(`line-${i}\r\n`)
      // Ten more lines have to be FULLY folded in before the shift is 10; a
      // partially-applied refresh reads as a smaller number.
      const expectedStart = (before.window?.startLine ?? 0) + 10
      await settleUntil(() => {
        expect(pty.captureWindow()?.startLine).toBe(expectedStart)
      })
      const after: Frame = { snapshot: pty.capture(), window: pty.captureWindow() }
      expect(after.window?.startLine).toBe(expectedStart)

      // The bug, stated: the untranslated endpoints now cover ten lines later.
      expect(extractSelection(after.snapshot, selected)).not.toBe(text)

      const rolled = followWindowShift(
        { anchor: selected.anchor, head: selected.head, shadow: EMPTY_SHADOW },
        before.window,
        after.window,
        after.snapshot.length,
        false,
      )
      const moved = rolled?.anchor && rolled.head ? { anchor: rolled.anchor, head: rolled.head } : null
      expect(moved).not.toBeNull()
      expect(extractSelection(after.snapshot, moved as SelectionRange)).toBe(text)
    } finally {
      unsubscribe()
      pty.kill()
    }
  })
})
