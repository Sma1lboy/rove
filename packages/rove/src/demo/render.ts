/**
 * ANSI painting for the demo replay. Kept apart from `replay.ts` so the state
 * machine stays testable as plain strings, and apart from `run.ts` so the
 * terminal-IO loop owns nothing but timing.
 */

import type { DemoFrame } from "./replay.ts"
import type { DemoTone } from "./session-script.ts"

const RESET = "\x1b[0m"

/** Claude Code reads warm; these 256-color picks survive a dark terminal. */
const TONE_CODES: Record<DemoTone, string> = {
  plain: "",
  dim: "\x1b[2m",
  muted: "\x1b[38;5;245m",
  accent: "\x1b[38;5;209m",
  ok: "\x1b[38;5;114m",
  warn: "\x1b[38;5;221m",
  err: "\x1b[38;5;203m",
}

/** Alternate screen, hidden cursor — the full-screen look a real engine has. */
export const ENTER_SCREEN = "\x1b[?1049h\x1b[?25l\x1b[2J\x1b[H"
export const LEAVE_SCREEN = "\x1b[0m\x1b[?25h\x1b[?1049l"

function clampWidth(text: string, cols: number): string {
  if (cols <= 0) return ""
  return text.length <= cols ? text : text.slice(0, cols)
}

function colorize(text: string, tone: DemoTone, color: boolean): string {
  const code = color ? TONE_CODES[tone] : ""
  return code ? `${code}${text}${RESET}` : text
}

/** `2100` → `2.1s`. One decimal, matching the footer copy. */
export function formatSeconds(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)}s`
}

/** `3400` → `3.4k`. */
export function formatTokens(tokens: number): string {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens)
}

export function statusLine(frame: DemoFrame): string {
  const status = frame.status
  if (!status) return ""
  return `${status.spinner} ${status.label}… · ${formatSeconds(status.elapsedMs)} · ↑ ${formatTokens(status.tokens)} tokens`
}

export interface PaintOptions {
  readonly cols: number
  readonly rows: number
  /** false emits plain text — used by tests and by `NO_COLOR` runs. */
  readonly color: boolean
}

/**
 * One whole-screen paint: home, clear below, the transcript, then the live
 * status on the bottom row. Clearing every frame is what a scripted replay can
 * afford and a real engine cannot — it needs no cursor bookkeeping.
 */
export function paintDemoFrame(frame: DemoFrame, opts: PaintOptions): string {
  const cols = Math.max(1, opts.cols)
  const rows = Math.max(2, opts.rows)
  const body = frame.lines.map((l) => colorize(clampWidth(l.text, cols), l.tone, opts.color))
  // Reserve the last row for the status; show the tail of a long transcript.
  const visible = body.slice(Math.max(0, body.length - (rows - 1)))
  const out = ["\x1b[H\x1b[J", visible.join("\r\n")]
  const status = clampWidth(statusLine(frame), cols)
  out.push(`\x1b[${rows};1H${status ? colorize(status, "accent", opts.color) : ""}\x1b[K`)
  return out.join("")
}
