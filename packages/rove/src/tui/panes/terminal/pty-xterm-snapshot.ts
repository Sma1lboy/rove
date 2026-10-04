/** Snapshot refresh for {@link XtermTaskPty}: scrollback cache, anchor marker, snapshot metadata. */

import type { TerminalStyleRewrite } from "@/types/terminal-presentation"
import type { IMarker, Terminal as XtermHeadless } from "@xterm/headless"
import type { CursorPos, TerminalRow, TerminalSnapshotWindow } from "./pty-types"
import { TerminalCursorSettlement } from "./terminal-cursor-settlement"
import { reconcileTerminalCursor, reconcileTerminalRow, reconcileTerminalRows } from "./terminal-snapshot"
import type { RowWrapFlags } from "./terminal-wrap"
import { xtermLineMatchesChunks, xtermLineToChunks } from "./xterm-chunks"
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
  /** Parallel to `snapshot`: row i is a soft-wrap continuation of row i-1. */
  wrapped: RowWrapFlags
  changed: boolean
  cursorPending: boolean
}

/** Retain the previous flags array when the wrap layout did not move. */
function sameFlags(previous: RowWrapFlags, next: readonly boolean[]): boolean {
  if (previous.length !== next.length) return false
  for (let i = 0; i < next.length; i++) if (previous[i] !== next[i]) return false
  return true
}

export class XtermSnapshotEngine {
  /** Frozen-scrollback conversion cache: absolute line id → converted row. */
  private readonly scrollbackCache = new Map<number, TerminalRow>()
  /** Frozen rows' `isWrapped`, so the fast path never allocates a `getLine` wrapper. */
  private readonly wrappedCache = new Map<number, boolean>()
  /** Last published flags — returned by reference when nothing changed, so a
   *  consumer memoizing on them does not re-scan the ring every frame. */
  private wrapped: RowWrapFlags = []
  private anchor: IMarker | undefined
  private anchorId = 0
  private snapshotEpoch = 0
  private publishedMeta: SnapshotMeta | null = null

  private readonly cursorSettlement: TerminalCursorSettlement

  constructor(
    private readonly alternateScreenStyleRewrites?: readonly TerminalStyleRewrite[],
    platform: NodeJS.Platform = process.platform,
  ) {
    this.cursorSettlement = new TerminalCursorSettlement(platform)
  }

  /** Drop the cache and anchor; called on resize/reflow or teardown. */
  invalidate(): void {
    this.scrollbackCache.clear()
    this.wrappedCache.clear()
    this.wrapped = []
    this.anchor?.dispose()
    this.anchor = undefined
    this.anchorId = 0
    this.publishedMeta = null
    this.cursorSettlement.reset()
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
    if (xtermSynchronizedOutput(term)) return null
    const active = term.buffer.active
    const styleRewrites = active.type === "alternate" ? this.alternateScreenStyleRewrites : undefined
    const cursorHidden = xtermCursorHidden(term)
    const currentMeta = snapshotMeta(active, rows, scrollbackRows)
    const nextCursor = reconcileTerminalCursor(
      previousCursor,
      cursorHidden ? null : { x: active.cursorX, y: active.baseY + active.cursorY - currentMeta.start },
    )
    const frameCursor = refreshTracker.synchronizedCursor
    const atFrameEnd =
      nextCursor !== null && frameCursor?.x === nextCursor.x && frameCursor.y === nextCursor.y + currentMeta.start
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
        styleRewrites,
      )
    ) {
      refreshTracker.clear()
      this.publishedMeta = currentMeta
      const cursor = this.cursorSettlement.update(nextCursor, previousSnapshot, atFrameEnd, Date.now())
      return {
        snapshot: previousSnapshot,
        cursor,
        snapshotWindow: previousWindow,
        wrapped: this.wrapped,
        changed: cursor !== previousCursor,
        cursorPending: this.cursorSettlement.pending,
      }
    }
    const alt = active.type === "alternate"
    const canAnchor = !alt && active.baseY > 0
    if (canAnchor && (this.anchor === undefined || this.anchor.isDisposed)) {
      this.scrollbackCache.clear()
      this.wrappedCache.clear()
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
    const wrappedCache = this.wrappedCache
    const rowsOut: TerminalRow[] = []
    const wrappedOut: boolean[] = []
    const cursorY = active.baseY + active.cursorY
    const start = currentMeta.start
    for (let y = start; y < active.length; y++) {
      const frozen = anchorAlive && y < active.baseY
      if (frozen) {
        const cached = cache.get(absBase + y)
        if (cached) {
          rowsOut.push(cached)
          wrappedOut.push(wrappedCache.get(absBase + y) ?? false)
          continue
        }
      }
      const line = active.getLine(y)
      const minLast = !cursorHidden && y === cursorY ? active.cursorX - 1 : -1
      const previousRow = previousSnapshot[rowsOut.length]
      // Verify cells before allocating chunks. This also handles scrolling
      // when a saturated buffer keeps the same length and baseY.
      const row: TerminalRow =
        previousRow && xtermLineMatchesChunks(line, previousRow, minLast, styleRewrites)
          ? previousRow
          : line
            ? xtermLineToChunks(line, minLast, styleRewrites)
            : []
      // The window's first row may continue a dropped row; treat it as a line start.
      const wraps = y > start && line?.isWrapped === true
      const stableRow = frozen ? reconcileTerminalRow(previousSnapshot[rowsOut.length], row) : row
      rowsOut.push(stableRow)
      wrappedOut.push(wraps)
      if (frozen) {
        cache.set(absBase + y, stableRow)
        wrappedCache.set(absBase + y, wraps)
      }
    }
    if (anchorAlive) {
      const min = absBase + start
      for (const id of cache.keys()) if (id < min) cache.delete(id)
      for (const id of wrappedCache.keys()) if (id < min) wrappedCache.delete(id)
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
    const cursor = this.cursorSettlement.update(nextCursor, snapshot, atFrameEnd, Date.now())
    const nextStartLine = absBase + start
    const snapshotWindow = anchorAlive
      ? previousWindow?.epoch === this.snapshotEpoch && previousWindow.startLine === nextStartLine
        ? previousWindow
        : { epoch: this.snapshotEpoch, startLine: nextStartLine }
      : null
    refreshTracker.clear()
    this.publishedMeta = currentMeta
    const wrapLayoutMoved = !sameFlags(this.wrapped, wrappedOut)
    if (wrapLayoutMoved) this.wrapped = wrappedOut
    const changed =
      snapshot !== previousSnapshot || cursor !== previousCursor || snapshotWindow !== previousWindow || wrapLayoutMoved
    return {
      snapshot,
      cursor,
      snapshotWindow,
      wrapped: this.wrapped,
      changed,
      cursorPending: this.cursorSettlement.pending,
    }
  }
}
