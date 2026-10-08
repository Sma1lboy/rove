/**
 * The demo replay state machine: script + elapsed time in, one frame out. Pure
 * and framework-free, so a test can pin the whole arc without a terminal.
 */

import { DEFAULT_SPINNER_FRAMES } from "../engine/spinner-frames.ts"
import type { DemoLine, DemoSessionScript } from "./session-script.ts"

/** Spinner step. 120ms reads as "alive" without burning CPU. */
export const SPINNER_INTERVAL_MS = 120

export interface DemoStatus {
  readonly spinner: string
  readonly label: string
  readonly elapsedMs: number
  readonly tokens: number
}

export interface DemoFrame {
  /** Everything printed so far, in order. */
  readonly lines: readonly DemoLine[]
  /** The live working line, or null once the script has gone quiet. */
  readonly status: DemoStatus | null
}

/**
 * The frame at `elapsedMs`. `elapsedMs` is clamped to >= 0; a value past the
 * script's last beat is the resting frame (no status) the runner loops from.
 */
export function demoFrameAt(script: DemoSessionScript, elapsedMs: number): DemoFrame {
  const t = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0
  const lines: DemoLine[] = []
  let label = "Thinking"
  let newest = -1
  for (const beat of script.beats) {
    if (beat.atMs > t) break
    newest = beat.atMs
    if (beat.working) label = beat.working
    lines.push(...beat.lines)
  }
  const restAtMs = script.beats[script.beats.length - 1]?.atMs ?? 0
  if (newest < 0 || t >= restAtMs) return { lines, status: null }
  const frame = DEFAULT_SPINNER_FRAMES[Math.floor(t / SPINNER_INTERVAL_MS) % DEFAULT_SPINNER_FRAMES.length] ?? "✳"
  return {
    lines,
    status: {
      spinner: frame,
      label,
      elapsedMs: t,
      tokens: Math.round(script.totalTokens * Math.min(1, t / script.durationMs)),
    },
  }
}

/** Loop position for a wall clock that keeps running past the script. */
export function demoLoopElapsed(script: DemoSessionScript, wallMs: number, loop: boolean): number {
  const t = Math.max(0, wallMs)
  if (!loop || script.durationMs <= 0) return t
  return t % script.durationMs
}
