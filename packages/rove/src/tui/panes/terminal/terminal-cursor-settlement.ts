import type { CursorPos, TerminalRow } from "./pty-types"

// ConPTY can emit a frame end before its correcting cursor write. Recorded
// corrections took 30–63 ms; wait only on vertical moves at those frame ends.
const CONPTY_CURSOR_SETTLE_MS = 80

export class TerminalCursorSettlement {
  private settled: CursorPos | null = null
  private settledRow: TerminalRow | undefined
  private candidate: { row: number; since: number } | null = null

  constructor(private readonly platform: NodeJS.Platform) {}

  get pending(): boolean {
    return this.candidate !== null
  }

  reset(): void {
    this.settled = null
    this.settledRow = undefined
    this.candidate = null
  }

  update(
    cursor: CursorPos | null,
    rows: readonly TerminalRow[],
    atSynchronizedFrameEnd: boolean,
    now: number,
  ): CursorPos | null {
    if (!cursor) {
      this.candidate = null
      return null
    }
    if (this.platform === "win32" && atSynchronizedFrameEnd && cursor.y !== this.settled?.y) {
      if (this.candidate?.row !== cursor.y) {
        this.candidate = { row: cursor.y, since: now }
      }
      if (now - this.candidate.since < CONPTY_CURSOR_SETTLE_MS) {
        // Retain only a cell whose row has not changed underneath it. Output
        // still paints immediately; a scrolling/replaced row hides the caret.
        return this.settled && rows[this.settled.y] === this.settledRow ? this.settled : null
      }
    }
    this.candidate = null
    this.settled = cursor
    this.settledRow = rows[cursor.y]
    return cursor
  }
}
