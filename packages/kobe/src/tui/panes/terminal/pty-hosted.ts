/**
 * HostedTaskPty — the default terminal backend (protocol v4). The PTY child
 * lives in the standalone `kobe pty-host` (`kobe-daemon/daemon/pty-server.ts`),
 * not the daemon or this TUI, so sessions survive quitting the TUI and
 * `kobe daemon restart`; reopening replays the host's byte ring into a fresh
 * local xterm. Only `kobe reset` (or the host idle-exiting at zero live
 * sessions) ends children. VT emulation stays here; only raw bytes (base64
 * `pty.data`) cross the socket.
 *
 * {@link TaskPtyLike} mapping: `kill()` → `pty.kill` ends the remote child;
 * `detach()` → `pty.detach` drops only this handle (app exit, via
 * `registry.detachAll()`).
 *
 * The constructor stays sync (registry contract) while the socket opens
 * async: input typed meanwhile is queued and flushed after the replay.
 */

import type { KobeDaemonClient } from "@sma1lboy/kobe-daemon/client"
import { logClientError } from "@sma1lboy/kobe-daemon/client/client-log"
import type { PtyOpenResult } from "@sma1lboy/kobe-daemon/daemon/protocol"
import { SerializeAddon } from "@xterm/addon-serialize"
import { pastePromptWhenEngineUp } from "../../../engine/hosted-session.ts"
import { getSharedPtyClient, routeAdd, routeCount, routeRemove } from "./pty-hosted-client"
import type { ParkedScreen, PtyDetachOpts, TaskPtyOpts } from "./pty-types"
import { XtermTaskPty } from "./pty-xterm-base"
import { xtermCursorHidden } from "./xterm-refresh"

export { warmHostedShell } from "./pty-hosted-client"

/** Minimum gap between the repaint wiggle's shrink and restore resizes —
 *  zero-gap TIOCSWINSZ pairs coalesce into ONE SIGWINCH at the unchanged
 *  final size, which size-comparing apps (claude) ignore. */
const WIGGLE_MIN_GAP_MS = 150

export class HostedTaskPty extends XtermTaskPty {
  private client: KobeDaemonClient | null = null
  private opened = false
  private pendingInput: string[] = []
  private pendingResize: { cols: number; rows: number } | null = null
  private unsubs: (() => void)[] = []
  /** See {@link TaskPtyLike.deadOnAttach}. Non-empty replay tells an already
   *  exited session apart from a failed fresh spawn. */
  deadOnAttach = false
  /** Our incarnation's child pid from `pty.open`; undefined until it lands.
   *  `pty.exit` routes by KEY, and a kill()→reopen under the same key (file
   *  swap, F5, engine degrade) races the old child's exit against our open. */
  private sessionPid: number | null | undefined = undefined
  /** A pid-tagged `pty.exit` that beat our open response; resolved in `openRemote`. */
  private pendingExitPid: number | null = null

  /** See {@link TaskPtyLike.shellPid}. Walkable only because the host runs on
   *  this machine; a remote host would need a host-side walk (not wired). */
  get shellPid(): number | null {
    return this.sessionPid ?? null
  }
  /** SerializeAddon riding our emulator — `capturePark` reads it. */
  private readonly serializer = new SerializeAddon()
  /** Host byte offset consumed: open response `offset` + every frame since.
   *  Recorded into {@link ParkedScreen}; null until the open response lands. */
  private hostOffset: number | null = null

  constructor(opts: TaskPtyOpts) {
    // The process-owning PTY host answers OSC 10/11 even while detached.
    super(opts, { respondToDefaultColorQueries: false })
    this.term.loadAddon(this.serializer)
    void this.openRemote(opts)
  }

  /** Whether we just created the session (fresh spawn or warm-shell adopt) —
   *  only then may `initialInput` be typed. Pre-`created` hosts fall back to
   *  "alive with empty replay", true only for a just-spawned child. */
  private static createdFresh(res: PtyOpenResult): boolean {
    return res.alive && (res.created ?? res.replay.length === 0)
  }

  private async openRemote(opts: TaskPtyOpts): Promise<void> {
    try {
      const client = await getSharedPtyClient()
      if (this.killed) return
      this.client = client
      // Shared O(1) dispatcher, not a per-handle `on("pty.data")` the client
      // would walk for every tab per chunk.
      routeAdd(this)
      this.unsubs.push(
        // Host/socket gone → dead-shell banner; reopen the tab to reattach.
        client.onLifecycle("close", () => this.remoteGone()),
      )
      const res = await client.request<PtyOpenResult>("pty.open", {
        key: this.taskId,
        cwd: this.cwd,
        command: opts.command,
        shell: opts.shell,
        cols: this.cols,
        rows: this.rows,
        defaultColors: opts.defaultColors,
        sinceOffset: opts.restore?.byteOffset,
        sincePid: opts.restore?.pid ?? undefined,
      })
      if (this.killed) return
      this.sessionPid = res.pid ?? null
      this.hostOffset = res.offset ?? null
      // Restore a parked screen only when the host proved the delta exact:
      // `sinceValid` = offset in window AND same pid (host-side, so a stale
      // restore gets the FULL ring). Local re-checks guard pre-offset hosts.
      const restored =
        opts.restore !== undefined &&
        res.sinceValid === true &&
        res.created !== true &&
        (res.pid ?? null) === opts.restore.pid
      // Replay before flushing queued input (past before future). feedReplay,
      // not feed: answering the replay's past terminal queries would inject
      // stray CPR/DA into the child's stdin.
      if (restored && opts.restore) {
        await this.restoreParked(opts.restore, Buffer.from(res.replay, "base64"))
        if (this.killed) return
      } else if (res.replay.length > 0) {
        this.feedReplay(Buffer.from(res.replay, "base64"))
      }
      this.opened = true
      if (this.pendingResize) {
        const { cols, rows } = this.pendingResize
        this.pendingResize = null
        this.sendResize(cols, rows)
      }
      // Engine line first (it belongs to the spawn), then queued keystrokes.
      const fresh = HostedTaskPty.createdFresh(res)
      if (opts.initialInput && fresh) this.sendInput(opts.initialInput)
      // Paste-delivery vendors (kimi) can't take the first message in argv
      // (positional slot is a subcommand); paste it once the engine is up,
      // fresh spawns only.
      if (opts.firstMessage && fresh) {
        void pastePromptWhenEngineUp(client, this.taskId, opts.engineBin, opts.firstMessage).catch((err) =>
          logClientError("pty-hosted", err),
        )
      }
      for (const data of this.pendingInput.splice(0)) this.sendInput(data)
      // A raced exit frame is ours only on pid match; otherwise it's the
      // key's previous incarnation dying.
      const parkedExitPid = this.pendingExitPid
      this.pendingExitPid = null
      if (!res.alive) {
        this.deadOnAttach = res.replay.length > 0 || restored
        this.remoteGone()
      } else if (parkedExitPid !== null && parkedExitPid === this.sessionPid) {
        this.remoteGone()
      } else if (res.replay.length > 0 && !restored) {
        // Live reattach: a ring tail starts mid-stream, so the replayed
        // screen is garbage until a full redraw, and same geometry raises no
        // SIGWINCH. Wiggle one row and back to force one (as tmux does).
        // ponytail: a 1-row-tall pane can't wiggle — never real.
        this.sendResize(this.cols, Math.max(1, this.rows - 1))
        // Zero-gap resizes coalesce into one SIGWINCH at the unchanged size
        // (measured: 2 → 1), so wait for the shrink repaint (≤500ms: macOS
        // may run a shell's trap a tick late; non-repainting children hit
        // the timeout) AND a WIGGLE_MIN_GAP_MS floor — a streaming child's
        // ordinary output would otherwise satisfy the wait instantly.
        await Promise.all([this.nextDataOrTimeout(500), new Promise((r) => setTimeout(r, WIGGLE_MIN_GAP_MS))])
        if (!this.killed) this.sendResize(this.cols, this.rows)
      }
    } catch (err) {
      logClientError("pty-hosted", err)
      this.remoteGone()
    }
  }

  protected transportWrite(data: string): void {
    if (!this.opened) {
      this.pendingInput.push(data)
      return
    }
    this.sendInput(data)
  }

  protected transportResize(cols: number, rows: number): void {
    if (!this.opened) {
      this.pendingResize = { cols, rows }
      return
    }
    this.sendResize(cols, rows)
  }

  /** kill() path — end the REMOTE child too (tab close / delete / reset). */
  protected transportKill(): void {
    const client = this.client
    if (client) void client.request("pty.kill", { key: this.taskId }).catch(() => {})
    this.cleanup()
  }

  /**
   * Forget the remote session even when this handle is already dead: the host
   * keeps exited sessions under their key for post-mortem reattach, and the
   * base kill() early-returns on `_killed`. Otherwise the next `pty.open`
   * reattaches the corpse instead of spawning — engine degrade closes the tab
   * and F5 on a dead shell does nothing.
   */
  override kill(): void {
    if (this.killed) {
      void this.client?.request("pty.kill", { key: this.taskId }).catch(() => {})
      return
    }
    super.kill()
  }

  /**
   * Snapshot the screen for a lossless wake: the serialized VT stream
   * (~100-200KB) replaces the multi-MB emulator while hidden. Null when an
   * exact restore is impossible (never attached, dead); the wake then falls
   * back to full replay + wiggle.
   */
  capturePark(): ParkedScreen | null {
    if (this.killed || !this.opened || this.hostOffset === null || this.sessionPid === undefined) return null
    try {
      return {
        // Buffer round-trip is load-bearing: serialize() returns a JSC rope
        // pinning the emulator's strings (~2MB retained per parked tab,
        // measured); the copy lets the disposed emulator be collected.
        serialized: Buffer.from(this.serializer.serialize({ scrollback: this.scrollback }), "utf8").toString(),
        title: this.windowTitle,
        cursorHidden: xtermCursorHidden(this.term),
        cols: this.cols,
        rows: this.rows,
        byteOffset: this.hostOffset,
        pid: this.sessionPid,
      }
    } catch {
      return null
    }
  }

  /**
   * Prime the emulator from a parked screen: parse at CAPTURE geometry
   * (wrapping is width-dependent), re-apply `?25l` (serialize drops it), feed
   * the host-confirmed delta, then reflow to the current size. Bit-identical
   * to never detaching, so no wiggle.
   */
  private async restoreParked(state: ParkedScreen, delta: Buffer): Promise<void> {
    const targetCols = this.cols
    const targetRows = this.rows
    if (state.cols !== targetCols || state.rows !== targetRows) this.resizeEmulator(state.cols, state.rows)
    this.feedReplay(state.serialized + (state.cursorHidden ? "\x1b[?25l" : ""))
    if (delta.byteLength > 0) this.feedReplay(delta)
    // Wait for queued parses before resizing (resize is immediate, writes
    // parse async). The exit listener covers a kill() mid-restore dropping
    // the write callback.
    await new Promise<void>((resolve) => {
      const off = this.onExit(resolve)
      this.term.write("", () => {
        off()
        resolve()
      })
    })
    if (!this.killed && (this.cols !== targetCols || this.rows !== targetRows)) {
      this.resizeEmulator(targetCols, targetRows)
    }
  }

  /** Drop this handle; the child keeps running in the pty host. */
  detach(opts: PtyDetachOpts = {}): void {
    const client = this.client
    this.cleanup()
    // One host sink per (key, connection): detach host-side only as the last
    // local viewer, or the surviving sibling's stream starves.
    const siblings = routeCount(this.taskId)
    if (client && siblings === 0) {
      void client
        .request("pty.detach", {
          key: this.taskId,
          parked: opts.parked === true,
          parkedScreenBytes: opts.parkedScreenBytes,
        })
        .catch(() => {})
    }
    this.silentDispose()
  }

  private sendInput(data: string): void {
    void this.client?.request("pty.write", { key: this.taskId, data }).catch(() => this.remoteGone())
  }

  protected sendResize(cols: number, rows: number): void {
    void this.client?.request("pty.resize", { key: this.taskId, cols, rows }).catch(() => {})
  }

  /** One-shot resolver armed by {@link nextDataOrTimeout}. */
  private dataWaiter: (() => void) | null = null

  /** See `TaskPtyLike.lastOutputAtMs` — live frames only (replays arrive in
   *  the open response, never through {@link feedFrame}). */
  private _lastOutputAt: number | null = null

  lastOutputAtMs(): number | null {
    return this._lastOutputAt
  }

  /** Resolve on the next inbound `pty.data` frame, or after `ms`. */
  protected nextDataOrTimeout(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.dataWaiter = null
        resolve()
      }, ms)
      this.dataWaiter = () => {
        this.dataWaiter = null
        clearTimeout(timer)
        resolve()
      }
    })
  }

  /**
   * Decode + feed one inbound `pty.data` frame. Public so the module-level
   * dispatcher (getSharedPtyClient) can route by key; not for outside use.
   */
  feedFrame(dataB64: string): void {
    this.dataWaiter?.()
    this._lastOutputAt = Date.now()
    const buf = Buffer.from(dataB64, "base64")
    // Earlier frames (a sibling's stream) are already inside the open `offset`.
    if (this.hostOffset !== null) this.hostOffset += buf.byteLength
    this.feed(buf)
  }

  /** `pty.exit` route: applied only for OUR child's pid (see `sessionPid`).
   *  Pre-pid hosts (no `pid` in the frame) die on any exit. */
  remoteExited(pid: number | null | undefined): void {
    if (this.killed) return
    if (pid === undefined) {
      this.remoteGone()
      return
    }
    if (this.sessionPid === undefined) {
      // Our open response hasn't landed — park; openRemote resolves it.
      this.pendingExitPid = pid
      return
    }
    if (pid !== null && pid === this.sessionPid) this.remoteGone()
  }

  /** Remote child or host gone → dead-shell banner. Public for the dispatcher. */
  remoteGone(): void {
    this.cleanup()
    this.markDead(false)
  }

  private cleanup(): void {
    // Unroute first so no in-flight frame reaches a torn-down handle; every
    // teardown path lands here.
    routeRemove(this)
    for (const unsub of this.unsubs.splice(0)) {
      try {
        unsub()
      } catch {
        /* best effort */
      }
    }
  }
}
