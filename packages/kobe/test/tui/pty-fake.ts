/**
 * Shared fake-transport PTY + the settle barrier its snapshot tests need.
 *
 * The barrier is the point. `XtermTaskPty` publishes a snapshot two hops
 * after output arrives: xterm parses the chunk and fires the write callback
 * asynchronously, and that callback arms a `setTimeout(SNAPSHOT_COALESCE_MS)`
 * (pty-xterm-base.ts `queueRefresh`). The tests used to wait out both hops
 * with one hard-coded `settle(60)`.
 *
 * That sleep was written when the coalesce period was 16ms. PR #878 raised it
 * to 33ms and left the 60 alone, so the margin covering an xterm parse plus
 * TWO timer dispatches fell to 27ms — fine on an idle laptop, not on a shared
 * CI runner. It showed up as `expected false to be true` (a publish that had
 * not arrived yet) and as `spy ... been called 1 times` (the PREVIOUS step's
 * publish arriving after `mockClear`, attributed to the wrong pump).
 * Shrinking the sleep to 34ms reproduces both, every run.
 *
 * `pump()` splits the two hops. xterm runs write callbacks in FIFO order, so
 * a follow-up empty write resolves strictly after the fed chunk's parse — the
 * unbounded half is now awaited, not slept through. Only the coalesce timer
 * is left, and {@link REFRESH_WINDOW_MS} budgets that one alone, anchored to
 * the product constant so raising it can't silently eat the margin again.
 *
 * The headroom over that constant is ABSOLUTE, not a multiple of it. It was
 * `SNAPSHOT_COALESCE_MS * 4`, which assumed the constant only ever grows;
 * when Windows went to 60fps the coalesce period HALVED to 16ms and the whole
 * budget fell with it, to 64ms, reproducing on windows-latest exactly the
 * flake this barrier exists to prevent. What needs covering is one timer
 * dispatch on a loaded shared runner, and that cost has nothing to do with
 * how fast the renderer draws.
 */

import type { TerminalRow } from "../../src/tui/panes/terminal/pty-types"
import { SNAPSHOT_COALESCE_MS, XtermTaskPty } from "../../src/tui/panes/terminal/pty-xterm-base"

/** Slack for the single timer dispatch left after `pump()` has awaited the
 *  parse — a scheduling cost on a shared runner, independent of frame rate. */
const TIMER_DISPATCH_HEADROOM_MS = 100

/** One coalesce period plus that slack. */
export const REFRESH_WINDOW_MS = SNAPSHOT_COALESCE_MS + TIMER_DISPATCH_HEADROOM_MS

export class FakeTransportPty extends XtermTaskPty {
  protected transportWrite(_data: string): void {}
  protected transportResize(_cols: number, _rows: number): void {}
  protected transportKill(): void {}

  /** Feed `data` and resolve once xterm has finished parsing it. The queued
   *  snapshot refresh is still one timer away — follow with {@link settleRefresh}. */
  async pump(data: string): Promise<void> {
    this.feed(data)
    await new Promise<void>((resolve) => this.term.write("", () => resolve()))
  }
}

/** Wait out the coalesced snapshot refresh armed by the last {@link FakeTransportPty.pump}. */
export function settleRefresh(ms = REFRESH_WINDOW_MS): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function rowsText(rows: readonly TerminalRow[]): string {
  return rows.map((row) => row.map((chunk) => chunk.text).join("")).join("\n")
}
