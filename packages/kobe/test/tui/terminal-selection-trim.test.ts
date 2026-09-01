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
/**
 * Wait for the snapshot pipeline to catch up with what was pumped in.
 *
 * The budget is large on purpose, and 100× what this test costs when it runs
 * alone (~50ms). `refreshSnapshot` refuses to snapshot a half-painted frame
 * and re-queues itself 16ms later — its own comment says a new sync block can
 * open before the previous write lands, "bouncing forever". Pumping 200 lines
 * in a loop is exactly that shape, so under a runner sharing a CPU with seven
 * other workers the pipeline can bounce for many rounds before it lands one.
 *
 * That is why a five-second budget still expired on CI while passing in 50ms
 * on every developer machine, and why raising it is the honest fix rather than
 * a papered-over race: nothing here is unordered, the work just takes as long
 * as it takes to win a scheduling slot (issue #94).
 */
const settleUntil = (check: () => void): Promise<void> => vi.waitFor(check, { timeout: 30_000, interval: 10 })

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
      // Wait for the shift to have LANDED, not for it to equal exactly ten.
      //
      // The backend refreshes at output cadence, so how much it folds in per
      // refresh depends on how much output piled up first — which under a
      // loaded runner is more than one write. Waiting on `=== start + 10`
      // therefore waits on a value the pipeline is free to step straight past,
      // and when it does the wait can only time out. That is this test's whole
      // flake history: it blocked four unrelated PRs and one release in a day
      // while passing in 50ms unloaded, because unloaded every refresh folds
      // exactly one line (issue #94).
      //
      // `>=` is not a weaker assertion here. What the test is about is that a
      // selection follows the window it was taken in, and `followWindowShift`
      // is handed both windows and derives the distance itself — so the
      // assertions below hold for ANY landed shift, and a larger one exercises
      // the same arithmetic over a longer distance.
      const minimumStart = (before.window?.startLine ?? 0) + 10
      await settleUntil(() => {
        expect(pty.captureWindow()?.startLine).toBeGreaterThanOrEqual(minimumStart)
      })
      const after: Frame = { snapshot: pty.capture(), window: pty.captureWindow() }
      expect(after.window?.startLine).toBeGreaterThanOrEqual(minimumStart)

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
