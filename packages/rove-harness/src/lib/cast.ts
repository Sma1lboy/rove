/**
 * asciicast v2 as the film pipeline reads it (written by `pty-cast.mjs`).
 * DOM-free: the `/harness` replay and the node-side renderer share it.
 */

export type CastEvent = readonly [
  time: number,
  kind: "o" | "r" | "m",
  data: string,
]

export type Cast = {
  readonly cols: number
  readonly rows: number
  readonly events: readonly CastEvent[]
}

export type CastMarker = { readonly t: number; readonly label: string }

export function parseCast(text: string): Cast {
  const [head, ...lines] = text.split("\n").filter((line) => line.length > 0)
  if (!head) throw new Error("empty cast")
  const header = JSON.parse(head) as {
    version?: number
    width?: number
    height?: number
  }
  if (header.version !== 2 || !header.width || !header.height) {
    throw new Error("not an asciicast v2 recording")
  }
  const events = lines.map((line) => JSON.parse(line) as CastEvent)
  return { cols: header.width, rows: header.height, events }
}

export function castMarkers(cast: Cast): CastMarker[] {
  return cast.events
    .filter((e) => e[1] === "m")
    .map(([t, , label]) => ({ t, label }))
}

export function castDuration(cast: Cast): number {
  return cast.events.at(-1)?.[0] ?? 0
}

export type SeekStep =
  | { readonly kind: "write"; readonly data: string }
  | { readonly kind: "resize"; readonly cols: number; readonly rows: number }

export type SeekPlan = {
  /** The terminal must be reset to the header size before the steps. */
  readonly reset: boolean
  readonly steps: readonly SeekStep[]
  /** Index of the first event not yet applied after the steps. */
  readonly cursor: number
}

/**
 * What a terminal that has applied `events[0, cursor)` must do to show time
 * `t`. Forward seeks only apply the gap; a backward seek replays from the top,
 * because xterm has no way to un-write. Consecutive output is coalesced into
 * one write so a long idle stretch costs one parse, not one per chunk.
 */
export function planSeek(cast: Cast, cursor: number, t: number): SeekPlan {
  const applied = cursor > 0 ? cast.events[cursor - 1] : undefined
  const reset = applied !== undefined && applied[0] > t
  let i = reset ? 0 : cursor
  const steps: SeekStep[] = []
  let pending = ""
  const flush = (): void => {
    if (pending) steps.push({ kind: "write", data: pending })
    pending = ""
  }
  for (; i < cast.events.length; i += 1) {
    const [time, kind, data] = cast.events[i] as CastEvent
    if (time > t) break
    if (kind === "o") pending += data
    else if (kind === "r") {
      flush()
      const [cols, rows] = data.split("x").map(Number)
      steps.push({ kind: "resize", cols: cols as number, rows: rows as number })
    }
  }
  flush()
  return { reset, steps, cursor: i }
}
