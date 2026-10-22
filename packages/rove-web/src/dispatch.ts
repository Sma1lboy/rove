/**
 * The Dispatch page's runner: where on the lane each in-flight row's courier stands and which
 * ASCII frame it shows, from the daemon's row alone (status, `at`, `statusAt`) and a clock.
 */

import type { DispatchRow } from "rove-bridge/protocol"

/** How long the courier takes to run the lane after a paste lands. */
export const TRAVEL_MS = 1_400
/** Frame period while something on the page moves. */
export const FRAME_MS = 160

// ponytail: placeholder courier until the owner picks Rove's character; every frame is 3 rows × 4 cols.
const SPRITES = {
  run: [
    ["  o ", " /|>", " / \\"],
    ["  o ", " <|\\", " / >"],
  ],
  knock: [
    [" o  ", " |) ", "/ \\ "],
    [" o  ", " |>.", "/ \\ "],
  ],
  work: [
    [" o_ ", " |\\=", "/ \\ "],
    [" o  ", "/|= ", "/ \\ "],
  ],
  ask: [[" o? ", " |\\ ", "/ \\ "]],
  done: [["\\o/ ", " |  ", "/ \\ "]],
  failed: [["    ", "    ", "o_/\\"]],
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
  // A failed courier falls where it was when the failure came; one that never left falls at the start.
  const x = pose === "failed" ? Math.min(1, Math.max(0, (row.statusAt - row.at) / TRAVEL_MS)) : pose === "run" ? ran : 1
  const frames = SPRITES[pose]
  return { x, pose, sprite: frames[frame % frames.length] ?? frames[0] }
}

/** True while some row still has a frame to change: a running, knocking or working courier. */
export function moving(rows: readonly DispatchRow[]): boolean {
  return rows.some((row) => !settled(row) && row.status !== "asking")
}

/** In flight first (oldest first, the order they left), then the newest settled ones. */
export function lanes(rows: readonly DispatchRow[], recent = 12): { open: DispatchRow[]; done: DispatchRow[] } {
  return {
    open: rows.filter((row) => !settled(row)),
    done: rows.filter(settled).slice(-recent).reverse(),
  }
}
