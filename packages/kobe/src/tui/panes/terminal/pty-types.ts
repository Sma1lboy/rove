import type { TerminalStyleRewrite } from "@/types/terminal-presentation"
import { parse } from "@ansi-tools/parser"
import { resolveLoginShell } from "@sma1lboy/kobe-daemon/daemon/platform-shell"
import type { TerminalDefaultColors } from "@sma1lboy/kobe-daemon/daemon/terminal-colors"
import type { TerminalInputModes } from "./keys-pure"
import type { Chunk } from "./sgr"
import type { RowWrapFlags } from "./terminal-wrap"

/** One rendered row: a list of opentui-ready style runs. */
export type TerminalRow = readonly Chunk[]

/** Queue work before a future frame; return a cancellation function. */
export type TerminalRefreshScheduler = (refresh: () => void) => () => void

export type TaskPtyOpts = {
  /** Visible panes share their renderer's clock instead of a second timer. */
  scheduleRefresh?: TerminalRefreshScheduler
  /** Working directory the shell should start in. Required. */
  cwd: string
  /** Stable id used by the registry. Required. */
  taskId: string
  /** Initial pane size. Default 80x24. */
  cols?: number
  /** Initial pane size. Default 80x24. */
  rows?: number
  /** Default foreground/background exposed to child terminal applications. */
  defaultColors?: TerminalDefaultColors
  /** Engine-owned cell substitutions applied only while the alternate screen is active. */
  alternateScreenStyleRewrites?: readonly TerminalStyleRewrite[]
  /** Scrollback rows for the xterm buffer. Defaults to the persisted
   *  Settings → Terminal preference (`state/scrollback.ts`); tests inject
   *  small buffers here to exercise trimming deterministically. */
  scrollback?: number
  /** Override `$SHELL`. Defaults to `process.env.SHELL` or `/bin/bash`. */
  shell?: string
  /** Spawn argv instead of an interactive shell (e.g. `["claude"]`); unset/empty → the user's shell. */
  command?: readonly string[]
  /**
   * Bytes typed after a FRESH spawn (the `shellSpawn` engine line + `\r`); tty
   * input buffering holds them until the shell reads. A reattach must NOT resend.
   */
  initialInput?: string
  /**
   * First message bracketed-pasted once the engine is up, for paste-delivery
   * vendors whose positional argv slot is a subcommand. Fresh spawn only, like
   * `initialInput`. Delivered by the hosted backend (`pastePromptWhenEngineUp`);
   * other backends ignore it.
   */
  firstMessage?: string
  /** Engine binary name the first-message engine-up probe matches against. */
  engineBin?: string
  /**
   * Parked screen to restore. If the host confirms the byte offset is still in
   * its ring window, the emulator is primed with `serialized` plus the delta
   * since park — bit-identical to never detaching. If trimmed away (or
   * respawned), falls back to full replay + repaint wiggle.
   */
  restore?: ParkedScreen
}

/**
 * What a parked (hidden, detached) tab keeps instead of its live xterm: the
 * SerializeAddon VT stream (~100-200KB, vs a multi-MB emulator). Captured by
 * `capturePark()` right before detach.
 */
export type ParkedScreen = {
  /** SerializeAddon output — a VT escape stream that rebuilds cells,
   *  colors, cursor, modes, and both screen buffers when written into a
   *  fresh emulator. */
  readonly serialized: string
  /** OSC 0/2 window title at park time (serialize doesn't carry it). */
  readonly title: string | null
  /** `?25l` state at park time (serialize doesn't carry it either). */
  readonly cursorHidden: boolean
  /** Geometry the serialized stream was captured at — the wake feed must
   *  happen at this size, then reflow to the pane's current size. */
  readonly cols: number
  readonly rows: number
  /** Monotonic host byte offset this client had consumed at park. */
  readonly byteOffset: number
  /** The session child's pid at park — a mismatch on wake means the key
   *  was killed + respawned while parked, so the screen is stale. */
  readonly pid: number | null
}

/** Metadata sent with a persistent-handle detach. It lets the PTY Host's
 * read-only inventory explain why a session has no attached terminal. */
export type PtyDetachOpts = {
  /** True only when the registry retained a serialized screen for this session. */
  readonly parked?: boolean
  /** UTF-8 byte size of that local serialized screen, never the screen itself. */
  readonly parkedScreenBytes?: number
}

/** Stable address of the first row in one bounded terminal snapshot. */
export type TerminalSnapshotWindow = {
  /** Changes whenever resize/reset invalidates the terminal's line identity. */
  readonly epoch: number
  /** Absolute line id of `rows[0]` within this epoch. */
  readonly startLine: number
}

/** Listener for a full rendered snapshot plus cursor and stable window address. */
export type DataListener = (
  rows: readonly TerminalRow[],
  cursor: CursorPos | null,
  window: TerminalSnapshotWindow | null,
  /** Parallel to `rows`: row i soft-wraps from row i-1 (one logical line).
   *  Omitted by emulator-less backends (`PipeTaskPty`, mocks) — every row
   *  is its own line. */
  wrapped?: RowWrapFlags,
) => void

/** Cursor position within the rendered pane, 0-based. */
export type CursorPos = { x: number; y: number }

export interface TaskPtyLike {
  readonly taskId: string
  readonly cwd: string
  readonly killed: boolean

  write(data: string): void
  /** Current child-requested keyboard modes used when kitty input must be re-encoded. */
  inputModes(): TerminalInputModes
  /**
   * Wrap in bracketed-paste markers when (and only when) the app enabled
   * DECSET 2004 — a multiline prompt must not execute line-by-line.
   */
  paste(text: string): void
  onData(cb: DataListener): () => void
  /**
   * Fires once when the process ends for any reason (exit, write failure,
   * kill()); immediately if already dead, so a late subscriber after a fast
   * crash still sees it. Drives the pane's dead-shell banner.
   */
  onExit(cb: () => void): () => void
  /**
   * OSC 0/2 window-title changes ("vim", "htop"). Replays the latest title on
   * subscribe, like `onData`; never fires if nothing sets one.
   */
  onTitleChange(cb: (title: string) => void): () => void
  /**
   * Pid of this PTY's child (the tab's shell), null before spawn/after death.
   * Root of the process-tree walk that answers "which engine runs in this tab"
   * (`engine/foreground.ts`). Omitted by backends with no real child.
   */
  readonly shellPid?: number | null
  /**
   * Wheel like a real terminal: mouse tracking on → forward an SGR wheel event
   * at (col,row) (1-based, pane-local); alternate screen without tracking → 3×
   * arrow keys. False when neither — the CALLER scrolls its local scrollback.
   */
  wheel(direction: "up" | "down", col: number, row: number): boolean
  /**
   * Mouse tracking on → forward an SGR press/release/drag and return true (the
   * app owns the click). False → the caller keeps it for local selection.
   */
  click(
    kind: "down" | "up" | "drag",
    button: 0 | 1 | 2,
    col: number,
    row: number,
    modifiers?: { shift?: boolean; alt?: boolean; ctrl?: boolean },
  ): boolean
  /**
   * The same `mouseTrackingMode` read `click()` gates on, exposed so the pane
   * sees the app take the mouse before any click — e.g. `vim` launched while
   * our selection is highlighted would stack two highlights the app can't
   * clear. Emulator-less backends (`PipeTaskPty`) omit it; the pane keeps the mouse.
   */
  readonly appOwnsMouse?: boolean
  /**
   * On the ALTERNATE screen (vim, less, engine TUI): the app owns scrollback and
   * our ring holds one screen, so scrollback search refuses. Emulator-less
   * backends omit it and count as normal.
   */
  readonly onAlternateScreen?: boolean
  resize(cols: number, rows: number): void
  /** Current emulator geometry in cells — the last size pushed via
   *  `resize()` (the spawn size before any resize). Backends without a
   *  real emulator (mocks) may omit it; size-gated callers (split-core's
   *  `splitFits`) then fall back to the depth cap. */
  readonly size?: { cols: number; rows: number }
  capture(): readonly TerminalRow[]
  captureCursor(): CursorPos | null
  /** Address paired with `capture()`; null for backends without stable line ids. */
  captureWindow(): TerminalSnapshotWindow | null
  /** Soft-wrap flags paired with `capture()`; see {@link DataListener}. */
  captureWrapped?(): RowWrapFlags
  kill(): void
  /**
   * Drop the handle WITHOUT ending a persistable session (the daemon backend
   * keeps its child for reattach); without persistence, omitted and callers
   * kill(). Used by `registry.detachAll()` and the park sweep.
   */
  detach?(opts?: PtyDetachOpts): void
  /**
   * Epoch ms since the last data subscriber left, null while subscribed. The
   * park sweep's idle signal (`registry.parkIdle`): only the mounted pane
   * subscribes, so "unwatched N ms" = "hidden N ms".
   */
  unwatchedSinceMs?(): number | null
  /**
   * Epoch ms of the last LIVE chunk (replays excluded). The park sweep's quiet
   * signal: parking a streaming session outruns the host ring (degraded wake),
   * can split an escape sequence (serialize has no parser state), and the
   * repaint wiggle coalesces under a live stream. Absent = quiet.
   */
  lastOutputAtMs?(): number | null
  /**
   * Snapshot for a lossless wake ({@link ParkedScreen}), taken right before
   * `detach()` and passed to the next `acquire()` as `TaskPtyOpts.restore`.
   * Null when exact restore is impossible (not attached, dead); the sweep still
   * detaches and the wake uses full replay.
   */
  capturePark?(): ParkedScreen | null
  /**
   * Attached to a session whose child had ALREADY exited (engine died while no
   * TUI was attached), so the tab layer resumes (`--resume <sessionId>`)
   * instead of treating it as a live exit (which degrades to a shell).
   */
  deadOnAttach?: boolean
}

export const DEFAULT_COLS = 80
export const DEFAULT_ROWS = 24
export const PIPE_SCROLLBACK_LIMIT = 200_000

export function defaultShell(): string {
  return resolveLoginShell()
}

/**
 * Payload of the last OSC 0/2 title escape in a chunk, or null. For
 * emulator-less backends (`PipeTaskPty`, `MockTaskPty`); `BunTerminalTaskPty`
 * gets it from `@xterm/headless`'s `onTitleChange`.
 */
export function extractOscTitle(chunk: string): string | null {
  let title: string | null = null
  for (const code of parse(chunk)) {
    if (code.type === "OSC" && (code.command === "0" || code.command === "2") && code.params[0]) {
      title = code.params[0]
    }
  }
  return title
}

/** Explicit `command` override, else a single-element shell argv. */
export function resolveArgv(opts: TaskPtyOpts): string[] {
  if (opts.command && opts.command.length > 0) return [...opts.command]
  return [opts.shell ?? defaultShell()]
}
