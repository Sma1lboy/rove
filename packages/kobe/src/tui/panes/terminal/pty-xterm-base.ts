/** Shared xterm-headless emulation for local and daemon-hosted PTYs.
 * Subclasses supply {@link feed}; VT behavior and snapshots live here once. */

import { Unicode11Addon } from "@xterm/addon-unicode11"
import { Terminal as XtermHeadless } from "@xterm/headless"
import { persistedScrollbackRows } from "../../../state/scrollback"
import { hostTargetFps } from "../../lib/host-render-options"
import { profileSpan, profileTick } from "../../lib/render-profile"
import type { TerminalInputModes } from "./keys-pure"
import { PtyListeners } from "./pty-listeners"
import {
  type CursorPos,
  DEFAULT_COLS,
  DEFAULT_ROWS,
  type DataListener,
  type TaskPtyLike,
  type TaskPtyOpts,
  type TerminalRefreshScheduler,
  type TerminalRow,
  type TerminalSnapshotWindow,
} from "./pty-types"
import { XtermSnapshotEngine } from "./pty-xterm-snapshot"
import type { RowWrapFlags } from "./terminal-wrap"
import {
  appOwnsMouse,
  mouseButtonSequence,
  onAlternateScreen,
  readInputModes,
  wheelSequence,
} from "./xterm-input-modes"
import { XtermRefreshTracker, wireXtermChannels, wireXtermDefaultColorQueries } from "./xterm-refresh"

/** Coalesce non-visual consumers that have no renderer to schedule work. */
export const SNAPSHOT_COALESCE_MS = Math.round(1000 / hostTargetFps())

export abstract class XtermTaskPty implements TaskPtyLike {
  readonly taskId: string
  readonly cwd: string
  protected readonly term: XtermHeadless
  private readonly listeners = new PtyListeners()
  private snapshot: readonly TerminalRow[] = []
  private cursor: CursorPos | null = null
  private snapshotWindow: TerminalSnapshotWindow | null = null
  private snapshotWrapped: RowWrapFlags = []
  /** Output arrived unsubscribed: rebuild lazily on capture()/subscribe, so
   * background sessions don't re-convert grid+scrollback at output cadence
   * for the 1.5s turn poll. */
  private snapshotDirty = false
  private readonly snapshotEngine: XtermSnapshotEngine
  private _title: string | null = null
  /** Epoch ms since zero data subscribers; null while watched. Starts
   * "unwatched now" so a never-subscribed handle ages toward the park sweep.
   * See `TaskPtyLike.unwatchedSinceMs`. */
  private _unwatchedSince: number | null = Date.now()
  private _killed = false
  /** True while a replay parses; cleared in that write's callback, which
   * xterm fires after its parse and before any later chunk's. */
  private muteReplies = false
  protected cols: number
  protected rows: number
  private cancelRefresh: (() => void) | null = null
  private readonly scheduleRefresh: TerminalRefreshScheduler | undefined
  /** Last refresh ATTEMPT (coalesce leading edge); 0 = never, so the first output draws immediately. */
  private lastRefreshAt = 0
  private readonly refreshTracker: XtermRefreshTracker
  /** From Settings → General → Terminal at construction; fixed for this PTY's lifetime. */
  private readonly scrollbackRows: number

  constructor(opts: TaskPtyOpts, options: { respondToDefaultColorQueries?: boolean } = {}) {
    this.taskId = opts.taskId
    this.cwd = opts.cwd
    this.scheduleRefresh = opts.scheduleRefresh
    this.cols = opts.cols ?? DEFAULT_COLS
    this.rows = opts.rows ?? DEFAULT_ROWS
    // Restored (parked) screens bring their title — serialize streams don't
    // carry OSC titles; the tab strip must not flash "shell" on wake.
    if (opts.restore?.title) this._title = opts.restore.title
    this.scrollbackRows = opts.scrollback ?? persistedScrollbackRows()
    this.term = new XtermHeadless({
      allowProposedApi: true,
      cols: this.cols,
      rows: this.rows,
      scrollback: this.scrollbackRows,
    })
    this.snapshotEngine = new XtermSnapshotEngine(opts.alternateScreenStyleRewrites)
    // Unicode 11 width tables: the default (Unicode 6) measures emoji as ONE
    // cell while modern apps — and kobe's cursor-overlay math in
    // lib/display-width.ts — measure TWO; emoji desynced cursor/wrap.
    this.term.loadAddon(new Unicode11Addon())
    this.term.unicode.activeVersion = "11"
    this.refreshTracker = new XtermRefreshTracker(this.term)

    const reply = (data: string): void => {
      if (this._killed || this.muteReplies) return
      try {
        this.transportWrite(data)
      } catch {
        /* best effort — child may have exited */
      }
    }
    wireXtermChannels(this.term, {
      // Replay-triggered replies answer past (already-answered) queries;
      // re-sending injects stray CPR/DA into stdin (scrambles claude).
      // `muteReplies` drops them; live replies flow.
      onReply: reply,
      onTitle: (title) => {
        if (!title || title === this._title) return
        this._title = title
        this.listeners.publishTitle(title)
      },
    })
    if (options.respondToDefaultColorQueries !== false) {
      wireXtermDefaultColorQueries(this.term, opts.defaultColors, reply)
    }
  }

  /** Send input bytes to the child over this backend's transport. */
  protected abstract transportWrite(data: string): void
  /** Propagate a resize to the child's PTY. */
  protected abstract transportResize(cols: number, rows: number): void
  /** End the child (kill()-path only — never called on observed exits). */
  protected abstract transportKill(): void

  get killed(): boolean {
    return this._killed
  }

  write(data: string): void {
    if (this._killed || data.length === 0) return
    try {
      this.transportWrite(data)
    } catch {
      this.markDead(false)
    }
  }

  inputModes(): TerminalInputModes {
    return readInputModes(this.term)
  }

  onExit(cb: () => void): () => void {
    if (this._killed) {
      cb()
      return () => {}
    }
    return this.listeners.addExit(cb)
  }

  onTitleChange(cb: (title: string) => void): () => void {
    const off = this.listeners.addTitle(cb)
    if (this._title) {
      try {
        cb(this._title)
      } catch {
        /* one listener must not break the others */
      }
    }
    return off
  }

  paste(text: string): void {
    if (this._killed || text.length === 0) return
    let bracketed = false
    try {
      bracketed = this.term.modes.bracketedPasteMode === true
    } catch {
      /* mode probe is best-effort */
    }
    this.write(bracketed ? `\x1b[200~${text}\x1b[201~` : text)
  }

  /** Mouse gestures are DELIVERED here but DECIDED in `xterm-input-modes.ts`:
   *  whether the program wants this event at all is a question about its
   *  mode state, and a null answer means Rove keeps the gesture for itself
   *  (scrollback, selection). */
  wheel(direction: "up" | "down", col: number, row: number): boolean {
    return this.emit(this._killed ? null : wheelSequence(this.term, direction, col, row))
  }

  click(
    kind: "down" | "up" | "drag",
    button: 0 | 1 | 2,
    col: number,
    row: number,
    modifiers?: { shift?: boolean; alt?: boolean; ctrl?: boolean },
  ): boolean {
    return this.emit(this._killed ? null : mouseButtonSequence(this.term, kind, button, col, row, modifiers))
  }

  /** Write `seq` to the child when there is one; the boolean is "the program
   *  took this gesture", which is what the pane branches on. */
  private emit(seq: string | null): boolean {
    if (seq === null) return false
    this.write(seq)
    return true
  }

  get appOwnsMouse(): boolean {
    return this._killed ? false : appOwnsMouse(this.term)
  }

  get onAlternateScreen(): boolean {
    return this._killed ? false : onAlternateScreen(this.term)
  }

  onData(cb: DataListener): () => void {
    // Refresh before registering so the lazy rebuild cannot double-notify.
    this.ensureFreshSnapshot()
    const off = this.listeners.addData(cb)
    this._unwatchedSince = null
    if (this.snapshot.length > 0) {
      try {
        cb(this.snapshot, this.cursor, this.snapshotWindow, this.snapshotWrapped)
      } catch {
        /* one listener must not break the others */
      }
    }
    return () => {
      off()
      if (this.listeners.dataCount === 0) {
        if (this.cancelRefresh) this.snapshotDirty = true
        this.cancelQueuedRefresh()
        if (this._unwatchedSince === null) this._unwatchedSince = Date.now()
      }
    }
  }

  unwatchedSinceMs(): number | null {
    return this._unwatchedSince
  }

  /** Park-capture accessors for persistent backends (see `HostedTaskPty.capturePark`). */
  protected get windowTitle(): string | null {
    return this._title
  }

  protected get scrollback(): number {
    return this.scrollbackRows
  }

  /** Emulator-only resize for the wake feed: the serialized stream must be
   *  parsed at its capture geometry; the child is NOT resized (the host
   *  already runs it at the pane's current size). */
  protected resizeEmulator(cols: number, rows: number): void {
    this.cols = cols
    this.rows = rows
    this.term.resize(cols, rows)
    this.invalidateScrollbackCache()
    this.refreshTracker.markAll()
  }

  get size(): { cols: number; rows: number } {
    return { cols: this.cols, rows: this.rows }
  }

  resize(cols: number, rows: number): void {
    if (this._killed) return
    this.cols = cols
    this.rows = rows
    try {
      this.term.resize(cols, rows)
      // Reflow rewraps history — every cached scrollback row is stale.
      this.invalidateScrollbackCache()
      this.transportResize(cols, rows)
      this.refreshTracker.markAll()
      this.refreshSnapshot()
    } catch {
      this.markDead(false)
    }
  }

  private invalidateScrollbackCache(): void {
    this.snapshotEngine.invalidate()
    this.snapshotWindow = null
  }
  capture(): readonly TerminalRow[] {
    this.ensureFreshSnapshot()
    return this.snapshot
  }

  captureCursor(): CursorPos | null {
    this.ensureFreshSnapshot()
    return this.cursor
  }

  captureWindow(): TerminalSnapshotWindow | null {
    this.ensureFreshSnapshot()
    return this.snapshotWindow
  }

  captureWrapped(): RowWrapFlags {
    this.ensureFreshSnapshot()
    return this.snapshotWrapped
  }

  /** Rebuild a lazily-deferred snapshot unless synchronized output is mid-frame. */
  private ensureFreshSnapshot(): void {
    if (!this.snapshotDirty || this._killed) return
    this.refreshSnapshot()
  }

  kill(): void {
    if (this._killed) return
    this.markDead(true)
  }

  /** Pass bytes, not decoded strings: xterm's streaming UTF-8 decoder
   * reassembles a glyph split across chunks; per-chunk decoding corrupts it. */
  protected feed(data: string | Uint8Array): void {
    this.feedInternal(data, false)
  }

  /** Replay chunk: auto-replies muted for exactly its parse (FIFO order puts
   * the un-mute between it and any later live chunk). */
  protected feedReplay(data: string | Uint8Array): void {
    this.feedInternal(data, true)
  }

  private feedInternal(data: string | Uint8Array, muteReplies: boolean): void {
    if (this._killed) return
    if (muteReplies) this.muteReplies = true
    profileTick("feed")
    this.term.write(data, () => {
      if (muteReplies) this.muteReplies = false
      if (!this.refreshTracker.supported) this.refreshTracker.markAll()
      this.queueRefresh()
    })
  }

  private queueRefresh(): void {
    // No subscriber → don't pay the full grid+scrollback conversion at
    // output cadence; mark stale and rebuild on capture()/subscribe.
    if (this.listeners.dataCount === 0) {
      this.snapshotDirty = true
      return
    }
    if (this.cancelRefresh) return
    if (this.scheduleRefresh) {
      this.snapshotDirty = true
      this.cancelRefresh = this.scheduleRefresh(() => {
        this.cancelRefresh = null
        this.refreshSnapshot()
      })
      return
    }
    // Non-visual subscribers still get immediate idle echoes and bounded bursts.
    const since = Date.now() - this.lastRefreshAt
    if (since >= SNAPSHOT_COALESCE_MS) {
      this.refreshSnapshot()
      return
    }
    const timer = setTimeout(() => {
      this.cancelRefresh = null
      this.refreshSnapshot()
    }, SNAPSHOT_COALESCE_MS - since)
    this.cancelRefresh = () => clearTimeout(timer)
  }

  private cancelQueuedRefresh(): void {
    this.cancelRefresh?.()
    this.cancelRefresh = null
  }

  private refreshSnapshot(): void {
    if (this._killed) return
    this.cancelQueuedRefresh()
    // Stamped on the ATTEMPT, not on success: the `result === null`
    // half-painted path below re-queues, and a leading edge that only moved
    // on success would find the period still elapsed and re-enter
    // synchronously, forever.
    this.lastRefreshAt = Date.now()
    const result = profileSpan("refresh", () =>
      this.snapshotEngine.refresh(
        this.term,
        this.rows,
        this.scrollbackRows,
        this.refreshTracker,
        this.snapshot,
        this.cursor,
        this.snapshotWindow,
      ),
    )
    if (result === null) {
      // Don't snapshot a half-painted frame. Self-reschedule rather than
      // relying solely on the closing write's callback — under rapid redraws
      // a new sync block can open before that write lands, bouncing forever.
      this.queueRefresh()
      return
    }
    this.snapshot = result.snapshot
    this.cursor = result.cursor
    this.snapshotWindow = result.snapshotWindow
    this.snapshotWrapped = result.wrapped
    this.snapshotDirty = false
    if (result.changed) this.publishSnapshot()
    if (result.cursorPending) this.queueRefresh()
  }

  private publishSnapshot(): void {
    profileTick("publish")
    this.listeners.publishData(this.snapshot, this.cursor, this.snapshotWindow, this.snapshotWrapped)
  }

  /** Free cell buffers now (the point of parking). capture() still serves the
   *  cached snapshot — term paths guard on `_killed` — so the dead-shell
   *  banner shows the final screen. */
  private disposeEmulator(): void {
    try {
      this.term.dispose()
    } catch {
      /* already disposed */
    }
  }

  protected markDead(killProcess: boolean): void {
    if (this._killed) return
    this._killed = true
    this.cancelQueuedRefresh()
    this.refreshTracker.dispose()
    this.disposeEmulator()
    if (killProcess) {
      try {
        this.transportKill()
      } catch {
        /* best effort */
      }
    }
    const exitCbs = this.listeners.drainExits()
    this.listeners.clearData()
    for (const cb of exitCbs) {
      try {
        cb()
      } catch {
        /* one listener must not break the others */
      }
    }
  }

  /**
   * Mark this handle dead WITHOUT firing exit listeners or touching the
   * child — the detach path (app teardown wants the daemon-hosted child
   * to keep running, and must not trigger dead-shell UI reactions
   * mid-teardown). Local-only backends fall back to kill().
   */
  protected silentDispose(): void {
    this._killed = true
    this.cancelQueuedRefresh()
    this.refreshTracker.dispose()
    this.disposeEmulator()
    this.listeners.clearAll()
  }
}
