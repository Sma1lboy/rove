/** Snapshot refresh engine for {@link XtermTaskPty}.
 *
 * Owns the scrollback cache, anchor marker, and snapshot metadata so the
 * main PTY class can stay focused on transport/lifecycle. */

import type { IMarker, Terminal as XtermHeadless } from "@xterm/headless"
import type { CursorPos, TerminalRow, TerminalSnapshotWindow } from "./pty-types"
import { reconcileTerminalCursor, reconcileTerminalRow, reconcileTerminalRows } from "./terminal-snapshot"
import { xtermLineToChunks } from "./xterm-chunks"
import {
  type SnapshotMeta,
  type XtermRefreshTracker,
  dirtyRowsMatchSnapshot,
  snapshotMeta,
  xtermCursorHidden,
  xtermSynchronizedOutput,
} from "./xterm-refresh"

export type XtermSnapshotRefreshResult = {
  snapshot: readonly TerminalRow[]
  cursor: CursorPos | null
  snapshotWindow: TerminalSnapshotWindow | null
  changed: boolean
}

export class XtermSnapshotEngine {
  /** Frozen-scrollback conversion cache: absolute line id → converted row. */
  private readonly scrollbackCache = new Map<number, TerminalRow>()
  private anchor: IMarker | undefined
  private anchorId = 0
  private snapshotEpoch = 0
  private publishedMeta: SnapshotMeta | null = null

  /** Drop the cache and anchor; called on resize/reflow or teardown. */
  invalidate(): void {
    this.scrollbackCache.clear()
    this.anchor?.dispose()
    this.anchor = undefined
    this.anchorId = 0
    this.publishedMeta = null
  }

  /** Rebuild the terminal snapshot, or return null when a synchronized-update
   *  DCS sequence is mid-frame and the caller should re-queue. */
  refresh(
    term: XtermHeadless,
    rows: number,
    scrollbackRows: number,
    refreshTracker: XtermRefreshTracker,
    previousSnapshot: readonly TerminalRow[],
    previousCursor: CursorPos | null,
    previousWindow: TerminalSnapshotWindow | null,
  ): XtermSnapshotRefreshResult | null {
    const active = term.buffer.active
    const cursorHidden = xtermCursorHidden(term)
    const currentMeta = snapshotMeta(active, rows, scrollbackRows)
    const nextCursor = reconcileTerminalCursor(
      previousCursor,
      cursorHidden ? null : { x: active.cursorX, y: active.baseY + active.cursorY - currentMeta.start },
    )
    const verifyAnchor = this.anchor
    const verifyFrozen =
      active.type !== "alternate" && verifyAnchor !== undefined && !verifyAnchor.isDisposed
        ? { baseY: active.baseY, absBase: this.anchorId - verifyAnchor.line, cache: this.scrollbackCache }
        : null
    if (
      dirtyRowsMatchSnapshot(
        active,
        previousSnapshot,
        this.publishedMeta,
        currentMeta,
        refreshTracker.peek(),
        cursorHidden,
        verifyFrozen,
      )
    ) {
      refreshTracker.clear()
      this.publishedMeta = currentMeta
      return {
        snapshot: previousSnapshot,
        cursor: nextCursor,
        snapshotWindow: previousWindow,
        changed: nextCursor !== previousCursor,
      }
    }
    if (xtermSynchronizedOutput(term)) return null
    const alt = active.type === "alternate"
    const canAnchor = !alt && active.baseY > 0
    if (canAnchor && (this.anchor === undefined || this.anchor.isDisposed)) {
      this.scrollbackCache.clear()
      const fresh = term.registerMarker(-active.cursorY - 1)
      if (fresh) {
        this.snapshotEpoch += 1
        this.anchor = fresh
        this.anchorId = fresh.line
      }
    }
    const anchorAlive = canAnchor && this.anchor !== undefined && !this.anchor.isDisposed
    const absBase = anchorAlive ? this.anchorId - (this.anchor as IMarker).line : 0
    const cache = this.scrollbackCache
    const rowsOut: TerminalRow[] = []
    const cursorY = active.baseY + active.cursorY
    const start = currentMeta.start
    for (let y = start; y < active.length; y++) {
      const frozen = anchorAlive && y < active.baseY
      if (frozen) {
        const cached = cache.get(absBase + y)
        if (cached) {
          rowsOut.push(cached)
          continue
        }
      }
      const line = active.getLine(y)
      const minLast = !cursorHidden && y === cursorY ? active.cursorX - 1 : -1
      const row: TerminalRow = line ? xtermLineToChunks(line, minLast) : []
      const stableRow = frozen ? reconcileTerminalRow(previousSnapshot[rowsOut.length], row) : row
      rowsOut.push(stableRow)
      if (frozen) cache.set(absBase + y, stableRow)
    }
    if (anchorAlive) {
      const min = absBase + start
      for (const id of cache.keys()) if (id < min) cache.delete(id)
    }
    if (canAnchor) {
      const next = term.registerMarker(-active.cursorY - 1)
      if (next) {
        this.anchorId = anchorAlive ? absBase + next.line : 0
        this.anchor?.dispose()
        this.anchor = next
      }
    }
    const snapshot = reconcileTerminalRows(previousSnapshot, rowsOut)
    const nextStartLine = absBase + start
    const snapshotWindow = anchorAlive
      ? previousWindow?.epoch === this.snapshotEpoch && previousWindow.startLine === nextStartLine
        ? previousWindow
        : { epoch: this.snapshotEpoch, startLine: nextStartLine }
      : null
    refreshTracker.clear()
    this.publishedMeta = currentMeta
    const changed = snapshot !== previousSnapshot || nextCursor !== previousCursor || snapshotWindow !== previousWindow
    return { snapshot, cursor: nextCursor, snapshotWindow, changed }
  }
}
