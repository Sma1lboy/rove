/**
 * A film is a storyboard recorded ONCE as an asciicast (`take`) and a cut
 * rendered from that recording as often as needed (`render`). Everything that
 * costs a live session lives in `take`; pacing, framing and encoding live in
 * the cut, so changing them never re-runs the take.
 */

import { join } from "node:path"
import type { Page } from "@playwright/test"
import type { CastMarker } from "../../src/lib/cast.ts"

/** Drop a marker into the recording; the cut addresses beats by label. */
export type Cue = (label: string) => Promise<void>

/** A time in the take: cast seconds, a cue label, or a cue shifted by seconds. */
export type Point = number | string | { readonly cue: string; readonly offset: number }

/** Play the recording from `from` to `to` at `rate`×. */
export type Segment = {
  readonly from: Point
  readonly to: Point
  readonly rate: number
}

/** The take's own `/harness` tab, for storyboards that quit and reopen the TUI.
 *  A reopen reattaches the SAME tab, so the recording stays one cast. */
export type TakeSession = {
  /** Kill the TUI process; the page shows it detached. */
  close(): Promise<void>
  /** Load the page again on the same tab, which spawns a fresh TUI. */
  reopen(): Promise<void>
}

/**
 * Footage for a composition to edit (`packages/branding/films/<name>`): one
 * mp4 per named cut in `cutFile` (`{ "clips": { id: Segment[] } }`), plus
 * `clips.json` with each clip's duration and pixel size.
 */
export type ClipsOutput = {
  readonly cutFile: string
  readonly dir: string
  readonly fps: number
}

export type Film = {
  readonly name: string
  /** Rebuild the fixture this film's take expects. */
  readonly setup?: () => Promise<void>
  /** Text the TUI shows once it has taken the terminal over. */
  readonly ready?: string
  /** Drive the live TUI on the warm hero stack (`hero-serve.ts`). */
  readonly take: (page: Page, cue: Cue, session: TakeSession) => Promise<void>
  /** Runs after a take was saved — undo fixture state the storyboard created. */
  readonly afterTake?: () => Promise<void> | void
  readonly viewport?: { readonly width: number; readonly height: number }
  /** Pacing of the film's own mp4/gif. */
  readonly cut?: readonly Segment[]
  /** Repo-relative outputs. */
  readonly out: {
    readonly mp4?: string
    readonly gif?: string
    readonly gifWidth?: number
    readonly clips?: ClipsOutput
  }
  /** Same-origin `/harness?wallpaper=` backdrop, used by take AND render: a
   *  transparent terminal answers OSC 11 differently, so the TUI draws differently. */
  readonly wallpaper?: string
}

export const VIEWPORT = { width: 1280, height: 800 } as const
export const FPS = 24
export const FILMS_DIR = join(import.meta.dirname, "..", "films")

export function castPath(name: string): string {
  return join(FILMS_DIR, `${name}.cast.gz`)
}

/** Cast time of every output frame the cut produces at `fps`. */
export function frameTimes(cut: readonly Segment[], markers: readonly CastMarker[], fps: number): number[] {
  const at = (point: Point): number => {
    if (typeof point === "number") return point
    const cue = typeof point === "string" ? point : point.cue
    const marker = markers.find((m) => m.label === cue)
    if (!marker) throw new Error(`cut references cue ${JSON.stringify(cue)}, which the take never recorded`)
    return marker.t + (typeof point === "string" ? 0 : point.offset)
  }
  const times: number[] = []
  for (const segment of cut) {
    const from = at(segment.from)
    const to = at(segment.to)
    if (to <= from || !(segment.rate > 0)) throw new Error(`segment ${JSON.stringify(segment)} is empty or runs backwards`)
    const frames = Math.round(((to - from) / segment.rate) * fps)
    for (let k = 0; k < frames; k += 1) times.push(from + (k * segment.rate) / fps)
  }
  return times
}
