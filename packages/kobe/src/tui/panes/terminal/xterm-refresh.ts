import type { TerminalStyleRewrite } from "@/types/terminal-presentation"
import {
  DEFAULT_TERMINAL_COLORS,
  type TerminalDefaultColors,
  formatDefaultColorReply,
  parseTerminalDefaultColors,
} from "@sma1lboy/kobe-daemon/daemon/terminal-colors"
import type { Terminal as XtermHeadless } from "@xterm/headless"
import type { CursorPos, TerminalRow } from "./pty-types"
import { type XtermLineLike, xtermLineMatchesChunks } from "./xterm-chunks"

/**
 * Wire xterm's outbound channels: query replies (`onData` — DA, CPR, DSR
 * answers MUST reach the child's stdin, or engines probing at startup take
 * broken redraw paths) and OSC 0/2 titles for the tab strip.
 */
export function wireXtermChannels(
  term: XtermHeadless,
  hooks: { onReply(data: string): void; onTitle(title: string): void },
): void {
  term.onData(hooks.onReply)
  term.onTitleChange(hooks.onTitle)
}

/** Answer OSC 10/11 in local xterm-backed terminals. Hosted PTYs disable
 * this because their process-owning host answers even with no TUI attached. */
export function wireXtermDefaultColorQueries(
  term: XtermHeadless,
  colors: TerminalDefaultColors | undefined,
  reply: (data: string) => void,
): void {
  const resolved = parseTerminalDefaultColors(colors) ?? DEFAULT_TERMINAL_COLORS
  for (const slot of [10, 11] as const) {
    term.parser.registerOscHandler(slot, (payload) => {
      if (payload !== "?") return false
      reply(formatDefaultColorReply(slot, resolved))
      return true
    })
  }
}

export type SnapshotMeta = {
  type: "normal" | "alternate"
  baseY: number
  length: number
  start: number
}

type DirtyRows = { kind: "all" } | { kind: "range"; start: number; end: number }
type Disposable = { dispose(): void }

type ActiveBufferLike = {
  type: "normal" | "alternate"
  baseY: number
  cursorX: number
  cursorY: number
  length: number
  getLine(index: number): XtermLineLike | undefined
}

/** Narrow adapter around xterm's internal dirty-row event; unsupported versions safely fall back to full checks. */
export class XtermRefreshTracker {
  private dirty: DirtyRows | null = null
  private readonly subscription: Disposable | null
  private readonly synchronizedCursorSubscription: Disposable
  private lastSynchronizedCursor: CursorPos | null = null
  readonly supported: boolean

  constructor(term: XtermHeadless) {
    this.synchronizedCursorSubscription = term.parser.registerCsiHandler({ prefix: "?", final: "l" }, (params) => {
      if (params.includes(2026)) {
        const active = term.buffer.active
        this.lastSynchronizedCursor = { x: active.cursorX, y: active.baseY + active.cursorY }
      }
      return false
    })
    const event = (
      term as unknown as {
        _core?: {
          _inputHandler?: {
            onRequestRefreshRows?: (listener: (range: { start: number; end: number } | undefined) => void) => Disposable
          }
        }
      }
    )._core?._inputHandler?.onRequestRefreshRows
    if (!event) {
      this.supported = false
      this.subscription = null
      return
    }
    this.supported = true
    this.subscription = event((range) => {
      if (!range) {
        this.dirty = { kind: "all" }
        return
      }
      if (!this.dirty) this.dirty = { kind: "range", start: range.start, end: range.end }
      else if (this.dirty.kind === "range") {
        this.dirty.start = Math.min(this.dirty.start, range.start)
        this.dirty.end = Math.max(this.dirty.end, range.end)
      }
    })
  }

  markAll(): void {
    this.dirty = { kind: "all" }
  }

  get synchronizedCursor(): CursorPos | null {
    return this.lastSynchronizedCursor
  }

  peek(): DirtyRows | null {
    return this.dirty
  }

  clear(): void {
    this.dirty = null
  }

  dispose(): void {
    this.subscription?.dispose()
    this.synchronizedCursorSubscription.dispose()
  }
}

export function snapshotMeta(active: ActiveBufferLike, viewportRows: number, scrollbackRows: number): SnapshotMeta {
  return {
    type: active.type,
    baseY: active.baseY,
    length: active.length,
    start: Math.max(0, active.length - (viewportRows + scrollbackRows)),
  }
}

function sameMeta(a: SnapshotMeta, b: SnapshotMeta): boolean {
  return a.type === b.type && a.baseY === b.baseY && a.length === b.length && a.start === b.start
}

/**
 * The rebuild path's absolute-id view of frozen scrollback, letting verify
 * skip rows that provably can't have changed. Synchronized-output engines
 * (DECSET 2026: claude, codex) end every frame with a rangeless refresh
 * (`{kind:"all"}`), so without this verify walks the whole window each
 * refresh — measured 0.63ms at 1000-row scrollback (3.9% of a core at the
 * 62.5Hz cap), paid before reaching the rows that actually differ.
 */
export interface FrozenScrollback {
  /** Rows below this index have scrolled out of the viewport. */
  readonly baseY: number
  /** Offset turning a buffer index into the anchor-relative absolute line id. */
  readonly absBase: number
  /** The rebuild path's absolute-id -> row cache. */
  readonly cache: ReadonlyMap<number, TerminalRow>
}

/** Exact, allocation-light proof that xterm's dirty rows still render to the published snapshot. */
export function dirtyRowsMatchSnapshot(
  active: ActiveBufferLike,
  snapshot: readonly TerminalRow[],
  previousMeta: SnapshotMeta | null,
  currentMeta: SnapshotMeta,
  dirty: DirtyRows | null,
  cursorHidden: boolean,
  frozen: FrozenScrollback | null = null,
  styleRewrites?: readonly TerminalStyleRewrite[],
): boolean {
  if (!previousMeta || !sameMeta(previousMeta, currentMeta) || !dirty) return false
  let first = currentMeta.start
  let last = currentMeta.length - 1
  if (dirty.kind === "range") {
    first = Math.max(first, active.baseY + dirty.start)
    last = Math.min(last, active.baseY + dirty.end)
  }
  const cursorY = active.baseY + active.cursorY
  for (let y = first; y <= last; y++) {
    const row = snapshot[y - currentMeta.start]
    if (!row) return false
    // xterm never edits a scrolled-out line (only trims top / appends), so a
    // frozen row cached under its ABSOLUTE id can't have changed. The
    // identity compare keeps this sound across a shift `sameMeta` can't see
    // (saturated buffer: meta constant while content scrolls): the id →
    // index mapping moves, the compare fails, and we fall to full rebuild.
    if (frozen && y < frozen.baseY && frozen.cache.get(frozen.absBase + y) === row) continue
    const minLast = !cursorHidden && y === cursorY ? active.cursorX - 1 : -1
    if (!xtermLineMatchesChunks(active.getLine(y), row, minLast, styleRewrites)) return false
  }
  return true
}

export function xtermSynchronizedOutput(term: XtermHeadless): boolean {
  try {
    return term.modes.synchronizedOutputMode === true
  } catch {
    return false
  }
}

export function xtermCursorHidden(term: XtermHeadless): boolean {
  try {
    return (
      (
        term as unknown as {
          _core?: { coreService?: { isCursorHidden?: boolean } }
        }
      )._core?.coreService?.isCursorHidden === true
    )
  } catch {
    return false
  }
}
