/** Shared xterm-headless emulation for local and daemon-hosted PTYs.
 * Subclasses supply {@link feed}; VT behavior and snapshots live here once. */

import { Unicode11Addon } from "@xterm/addon-unicode11"
import { Terminal as XtermHeadless } from "@xterm/headless"
import { persistedScrollbackRows } from "../../../state/scrollback"
import { encodeWheel } from "./keys-pure"
import { PtyListeners } from "./pty-listeners"
import {
  type CursorPos,
  DEFAULT_COLS,
  DEFAULT_ROWS,
  type TaskPtyLike,
  type TaskPtyOpts,
  type TerminalRow,
  type TerminalSnapshotWindow,
} from "./pty-types"
import { XtermSnapshotEngine } from "./pty-xterm-snapshot"
import { XtermRefreshTracker, wireXtermChannels } from "./xterm-refresh"

export abstract class XtermTaskPty implements TaskPtyLike {
  readonly taskId: string
  readonly cwd: string
  protected readonly term: XtermHeadless
  private readonly listeners = new PtyListeners()
  private snapshot: readonly TerminalRow[] = []
  private cursor: CursorPos | null = null
  private snapshotWindow: TerminalSnapshotWindow | null = null
  /** Output arrived while nobody was subscribed — snapshot is stale and
   * will be rebuilt lazily on the next capture()/subscribe. Keeps the N
   * background sessions of a multi-task workspace from re-converting
   * their full grid+scrollback at output cadence for a consumer (the
   * 1.5s turn poll) that only reads via capture(). */
  private snapshotDirty = false
  private readonly snapshotEngine = new XtermSnapshotEngine()
  private _title: string | null = null
  /** Since when the pty has had zero data subscribers (epoch ms), null
   * while watched. Fresh instances start "unwatched now" — the mounting
   * pane subscribes within a tick; a handle that never gets a subscriber
   * (defensive acquire) should age toward the park sweep, not hide from
   * it. See `TaskPtyLike.unwatchedSinceMs`. */
  private _unwatchedSince: number | null = Date.now()
  private _killed = false
  /** True while a ring-buffer replay is being parsed — see the reply
   * channel in the constructor. Flips back in the replay write's
   * completion callback, which xterm fires strictly after that chunk's
   * parse and before any later `feed` chunk's. */
  private muteReplies = false
  protected cols: number
  protected rows: number
  private refreshQueued = false
  private readonly refreshTracker: XtermRefreshTracker
  /** Scrollback rows resolved from the persisted preference at construction
   * (Settings → General → Terminal) — fixed for this PTY's lifetime. */
  private readonly scrollbackRows: number

  constructor(opts: TaskPtyOpts) {
    this.taskId = opts.taskId
    this.cwd = opts.cwd
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
    // Unicode 11 width tables: the default (Unicode 6) measures emoji as ONE
    // cell while modern apps — and kobe's cursor-overlay math in
    // lib/display-width.ts — measure TWO; emoji desynced cursor/wrap.
    this.term.loadAddon(new Unicode11Addon())
    this.term.unicode.activeVersion = "11"
    this.refreshTracker = new XtermRefreshTracker(this.term)

    wireXtermChannels(this.term, {
      // `muteReplies`: replies triggered while parsing a ring-buffer REPLAY
      // answer queries the child asked in the PAST (already answered by the
      // then-attached emulator); re-answering injects unsolicited CPR/DA
      // into the child's stdin (scrambled claude's renderer). Live flows.
      onReply: (data) => {
        if (this._killed || this.muteReplies) return
        try {
          this.transportWrite(data)
        } catch {
          /* best effort — child may have exited */
        }
      },
      onTitle: (title) => {
        if (!title || title === this._title) return
        this._title = title
        this.listeners.publishTitle(title)
      },
    })
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

  wheel(direction: "up" | "down", col: number, row: number): boolean {
    if (this._killed) return false
    try {
      const modes = this.term.modes
      const seq = encodeWheel(
        {
          mouseTracking: modes.mouseTrackingMode !== "none",
          applicationCursorKeys: modes.applicationCursorKeysMode === true,
          alternateScreen: this.term.buffer.active.type === "alternate",
        },
        direction,
        col,
        row,
      )
      if (seq !== null) {
        this.write(seq)
        return true
      }
    } catch {
      /* mode probe is best-effort */
    }
    return false
  }

  onData(
    cb: (snapshot: readonly TerminalRow[], cursor: CursorPos | null, window: TerminalSnapshotWindow | null) => void,
  ): () => void {
    // Refresh before registering so the lazy rebuild cannot double-notify.
    this.ensureFreshSnapshot()
    const off = this.listeners.addData(cb)
    this._unwatchedSince = null
    if (this.snapshot.length > 0) {
      try {
        cb(this.snapshot, this.cursor, this.snapshotWindow)
      } catch {
        /* one listener must not break the others */
      }
    }
    return () => {
      off()
      if (this.listeners.dataCount === 0 && this._unwatchedSince === null) this._unwatchedSince = Date.now()
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

  /** Rebuild a lazily-deferred snapshot unless synchronized output is mid-frame. */
  private ensureFreshSnapshot(): void {
    if (!this.snapshotDirty || this._killed) return
    this.refreshSnapshot()
  }

  kill(): void {
    if (this._killed) return
    this.markDead(true)
  }

  /** Hand raw child output to xterm. Bytes, not decoded strings: xterm's
   * parser keeps a streaming UTF-8 decoder across `write` calls, so a
   * multi-byte glyph (box-drawing `─`, claude's status icons) split across
   * a chunk boundary is reassembled correctly. Decoding each chunk here
   * instead corrupted any glyph straddling a boundary. */
  protected feed(data: string | Uint8Array): void {
    this.feedInternal(data, false)
  }

  /** Feed a ring-buffer REPLAY: parsed like live output, but the emulator's
   * auto-replies are muted for exactly this chunk's parse (see the reply
   * channel). Live chunks fed after this parse in FIFO order, so the
   * un-mute callback lands between the replay's parse and theirs. */
  protected feedReplay(data: string | Uint8Array): void {
    this.feedInternal(data, true)
  }

  private feedInternal(data: string | Uint8Array, muteReplies: boolean): void {
    if (this._killed) return
    if (muteReplies) this.muteReplies = true
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
    if (this.refreshQueued) return
    this.refreshQueued = true
    setTimeout(() => {
      this.refreshQueued = false
      this.refreshSnapshot()
    }, 16)
  }

  private refreshSnapshot(): void {
    if (this._killed) return
    const result = this.snapshotEngine.refresh(
      this.term,
      this.rows,
      this.scrollbackRows,
      this.refreshTracker,
      this.snapshot,
      this.cursor,
      this.snapshotWindow,
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
    this.snapshotDirty = false
    if (result.changed) this.publishSnapshot()
  }

  private publishSnapshot(): void {
    this.listeners.publishData(this.snapshot, this.cursor, this.snapshotWindow)
  }

  /** Free the emulator's cell buffers NOW instead of waiting for GC — the
   *  whole point of parking a hidden tab. The last snapshot stays readable
   *  (capture() serves the cached rows; every term-touching path guards on
   *  `_killed`), so the dead-shell banner still shows the final screen. */
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
    this.refreshTracker.dispose()
    this.disposeEmulator()
    this.listeners.clearAll()
  }
}
