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

/** Play the recording from `from` to `to` (a cue label or cast seconds) at `rate`×. */
export type Segment = {
  readonly from: string | number
  readonly to: string | number
  readonly rate: number
}

export type Film = {
  readonly name: string
  /** Drive the live TUI on the warm hero stack (`hero-serve.ts`). */
  readonly take: (page: Page, cue: Cue) => Promise<void>
  /** Runs after a take was saved — undo fixture state the storyboard created. */
  readonly afterTake?: () => Promise<void> | void
  readonly cut: readonly Segment[]
  /** Repo-relative outputs. */
  readonly out: { readonly mp4?: string; readonly gif?: string; readonly gifWidth?: number }
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
  const at = (point: string | number): number => {
    if (typeof point === "number") return point
    const marker = markers.find((m) => m.label === point)
    if (!marker) throw new Error(`cut references cue ${JSON.stringify(point)}, which the take never recorded`)
    return marker.t
  }
  const times: number[] = []
  for (const segment of cut) {
    const from = at(segment.from)
    const to = at(segment.to)
    if (to <= from) throw new Error(`segment ${JSON.stringify(segment)} runs backwards`)
    const frames = Math.round(((to - from) / segment.rate) * fps)
    for (let k = 0; k < frames; k += 1) times.push(from + (k * segment.rate) / fps)
  }
  return times
}
