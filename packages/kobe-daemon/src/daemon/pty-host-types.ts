/** PtyHost's contract types, importable without the host itself. */

import { randomUUID } from "node:crypto"
import { StringDecoder } from "node:string_decoder"
import type { DaemonFrame, PtySessionExit } from "./protocol.ts"
import type { PtyChild, PtyDriver } from "./pty-driver.ts"
import type { PtyFreezeSink } from "./pty-freeze-store.ts"
import type { PtySessionEndInfo } from "./pty-observability.ts"
import { DEFAULT_TERMINAL_COLORS, type TerminalDefaultColors, parseTerminalDefaultColors } from "./terminal-colors.ts"

/** Everything `pty.open` needs to spawn a session's child on first open. */
export interface PtySpawnSpec {
  readonly cwd: string
  /** Explicit argv (engine sessions). Falls back to `shell`. */
  readonly command?: readonly string[]
  /** Shell override; defaults to `resolveLoginShell()`. */
  readonly shell?: string
  /** Absent = size-agnostic open: fresh spawn gets 80×24, reattach NEVER
   *  resizes. Only size-carrying opens (the TUI) take last-attach-wins. */
  readonly cols?: number
  readonly rows?: number
  /** Default colors reported to child applications through OSC 10/11. */
  readonly defaultColors?: TerminalDefaultColors
}

/** Attach result — mirrors the wire `PtyOpenResult`. */
export interface PtyAttachResult {
  readonly replay: string
  readonly alive: boolean
  /** The session child's pid (null when spawn failed) — see `PtyOpenResult.pid`. */
  readonly pid: number | null
  /** True when this open spawned/adopted the session — see `PtyOpenResult.created`. */
  readonly created: boolean
  /** RESPAWNED a freeze-restored corpse: pre-restart replay, new child. See `PtyOpenResult.respawned`. */
  readonly respawned: boolean
  /** Monotonic byte offset at attach — see `PtyOpenResult.offset`. */
  readonly offset: number
  /** `replay` is the exact delta since the request's `sinceOffset` — see `PtyOpenResult.sinceValid`. */
  readonly sinceValid: boolean
}

/** Writes one event frame to an attached connection. */
export type PtySink = (frame: DaemonFrame) => void

/** One hosted session's mutable state; here so the freeze store avoids an import cycle. */
export interface PtySessionState {
  /** Mutable: warm-shell adoption re-keys the spare under the opener's key. */
  key: string
  generation: string
  readonly cwd: string
  proc: PtyChild | null
  alive: boolean
  chunks: Buffer[]
  bytes: number
  /** Monotonic bytes EVER written. `totalBytes - bytes` is the ring start
   *  offset, so a client's offset survives trims and delta replays are exact. */
  totalBytes: number
  cols: number
  rows: number
  /** Mutable: a freeze-restored session's respawn adopts the caller's
   *  launch (the TUI's dead-reattach passes its `--resume` argv). */
  command: readonly string[]
  title: string
  /** Unterminated escape tail carried between chunks for the title scan. */
  titleCarry: string
  /** UTF-8 decoder for the title scan (a multibyte title may split across chunks). */
  readonly titleDecoder: StringDecoder
  /** Incomplete OSC 10/11 query carried across PTY output chunks. */
  colorQueryCarry: string
  /** Colors this terminal reports to applications running in the child. */
  defaultColors: TerminalDefaultColors
  /** Attached connections, keyed by connection identity (the server's ClientState). */
  readonly sinks: Map<object, PtySink>
  /** A detached TUI still holds a serialized screen for an exact-delta wake. */
  parked: boolean
  parkedScreenBytes: number
  /** Death cause, recorded once by markExited; null while alive. */
  exit: PtySessionExit | null
  /** Set by `kill()`: a requested close still exits by signal, and without
   *  this would be persisted as a crash death record. */
  closedByRequest?: boolean
  /** Freeze-restored and not yet respawned: a host-death casualty (respawn on
   *  attach), unlike an ordinary corpse (view only). */
  restored: boolean
  /** Freeze bookkeeping: output/exit drift since the last persisted snapshot. */
  lastFreezeAtMs: number
  /** `totalBytes` at the last snapshot; gates periodic whole-ring rewrites.
   *  Optional: an older host's record reads as "nothing frozen yet". */
  frozenTotalBytes?: number
}

/** Durable-snapshot sink the host reports freezeable moments to. */
export type { PtyFreezeSink }

export interface PtyHostOptions {
  /** A session's child spawned — cancels a pending daemon idle-stop grace. */
  readonly onSessionStart?: () => void
  /** A session's child ended — may arm the idle-stop grace. */
  readonly onSessionEnd?: () => void
  /** Death record (exit status + output tail) per ended session — the
   *  durable-persistence hook. MUST be fail-safe; the host guards it. */
  readonly onSessionExit?: (info: PtySessionEndInfo) => void
  /** Freeze/restore sink. Absent = session state dies with this process. */
  readonly freeze?: PtyFreezeSink
  /** Ring-buffer cap in bytes per session. Default 512KiB (`DEFAULT_SCROLLBACK_CAP`). */
  readonly scrollbackCap?: number
  /** How children spawn. Default Bun's; the Windows host injects node-pty's. */
  readonly driver?: PtyDriver
  readonly log?: (event: string, message: string) => void
}

/** A fresh session's initial state; the host starts the child and owns every mutation after. */
export function freshSessionState(key: string, spec: PtySpawnSpec, argv: readonly string[]): PtySessionState {
  return {
    key,
    generation: randomUUID(),
    cwd: spec.cwd,
    proc: null,
    alive: true,
    chunks: [],
    bytes: 0,
    totalBytes: 0,
    cols: spec.cols ?? 80,
    rows: spec.rows ?? 24,
    command: argv,
    title: "",
    titleCarry: "",
    titleDecoder: new StringDecoder("utf8"),
    colorQueryCarry: "",
    defaultColors: parseTerminalDefaultColors(spec.defaultColors) ?? DEFAULT_TERMINAL_COLORS,
    sinks: new Map(),
    parked: false,
    parkedScreenBytes: 0,
    exit: null,
    restored: false,
    lastFreezeAtMs: 0,
    frozenTotalBytes: 0,
  }
}
