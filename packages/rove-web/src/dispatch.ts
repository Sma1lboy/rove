/**
 * The Dispatch page's courier: where on its wire it stands and which ASCII frame it shows, from
 * the daemon's row alone (status, `at`, `statusAt`) and a clock.
 */

import type { DispatchRow } from "rove-bridge/protocol"
import { ease } from "./dispatch-graph.ts"

/** How long the courier takes to run sender → hub → target after a paste lands. */
export const TRAVEL_MS = 1_800
/** Frame period of the courier's own animation (legs, arms). */
export const FRAME_MS = 160
/** How long a settled courier stays on the map: a cheer, or where it fell. */
const LINGER_MS: Readonly<Record<string, number>> = { done: 4_000, failed: 10_000 }

// ponytail: placeholder courier until the owner picks Rove's character; every frame is 3 rows × 3 cols.
const SPRITES = {
  run: [
    [" o ", "/|>", "/ \\"],
    [" o ", "<|\\", " >\\"],
  ],
  knock: [
    [" o ", " |)", "/ \\"],
    [" o ", " |>", "/ \\"],
  ],
  work: [
    [" o_", " |=", "/ \\"],
    ["_o ", "=| ", "/ \\"],
  ],
  ask: [[" o?", "/|\\", "/ \\"]],
  done: [["\\o/", " | ", "/ \\"]],
  failed: [["   ", "   ", "o_/"]],
} as const

export type Pose = keyof typeof SPRITES

export interface Runner {
  /** 0 = at the sender, 1 = at the target. */
  readonly x: number
  readonly pose: Pose
  readonly sprite: readonly string[]
}

export function settled(row: DispatchRow): boolean {
  return row.status === "done" || row.status === "failed"
}

/** In flight, or settled recently enough that its courier is still on the map. */
export function onMap(row: DispatchRow, now: number): boolean {
  return !settled(row) || now - row.statusAt < (LINGER_MS[row.status] ?? 0)
}

export function runnerOf(row: DispatchRow, now: number, frame: number): Runner {
  const ran = Math.min(1, Math.max(0, (now - row.at) / TRAVEL_MS))
  const pose: Pose =
    row.status === "failed"
      ? "failed"
      : row.status === "done"
        ? "done"
        : row.status === "asking"
          ? "ask"
          : row.status === "working"
            ? "work"
            : ran < 1
              ? "run"
              : "knock"
  // A failed courier falls where the failure caught it; one that never left falls at the start.
  const x =
    pose === "failed"
      ? ease(Math.min(1, Math.max(0, (row.statusAt - row.at) / TRAVEL_MS)))
      : pose === "run"
        ? ease(ran)
        : 1
  const frames = SPRITES[pose]
  return { x, pose, sprite: frames[frame % frames.length] ?? frames[0] }
}

/** True while some courier still has a frame to change. */
export function moving(rows: readonly DispatchRow[], now: number): boolean {
  return rows.some((row) => onMap(row, now) && row.status !== "asking")
}

/** The newest settled rows, newest first, for the history under the map. */
export function recent(rows: readonly DispatchRow[], count = 12): DispatchRow[] {
  return rows.filter(settled).slice(-count).reverse()
}
