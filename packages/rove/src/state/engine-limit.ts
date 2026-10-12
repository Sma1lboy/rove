/**
 * Cap on live engine sessions `rove api` will run at once
 * (`engine.maxLiveSessions` in state.json). Off unless set: a scripted or
 * agent-driven fan-out otherwise starts one engine per task with nothing
 * stopping it short of the machine running out of memory.
 */

import { loadStateFile } from "./store"

export const MAX_LIVE_ENGINES_KEY = "engine.maxLiveSessions"

/** A positive whole number, or `undefined` (no cap) for anything else. */
export function normalizeMaxLiveEngines(value: unknown): number | undefined {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value.trim())
        : Number.NaN
  return Number.isInteger(n) && n > 0 ? n : undefined
}

export function persistedMaxLiveEngines(): number | undefined {
  return normalizeMaxLiveEngines(loadStateFile()[MAX_LIVE_ENGINES_KEY])
}
