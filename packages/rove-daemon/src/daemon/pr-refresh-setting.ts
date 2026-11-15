/**
 * `pr.refreshSeconds` in `state.json`: how often an open PR's status and checks
 * are re-read. Read per poller pass, so a hand edit applies without a restart.
 */

import { readFileSync, statSync } from "node:fs"
import { defaultUiPrefsStatePath } from "./product-paths.ts"

export const PR_REFRESH_SECONDS_KEY = "pr.refreshSeconds"
/** The poller's tick: a shorter cadence could not be honoured. */
export const PR_REFRESH_MIN_SECONDS = 30
export const PR_REFRESH_MAX_SECONDS = 3600

/**
 * `0` → background refresh off; an integer in range → that cadence in ms;
 * anything else (absent, malformed, out of range) → `undefined`, the default.
 */
export function normalizePrRefreshSeconds(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value)) return undefined
  if (value === 0) return 0
  if (value < PR_REFRESH_MIN_SECONDS || value > PR_REFRESH_MAX_SECONDS) return undefined
  return value * 1000
}

/**
 * A reader that re-parses `state.json` only when its mtime or size moves: the
 * file also holds tab layouts and is re-checked every tick. A missing or
 * invalid file reads as the default; the daemon never rewrites it.
 */
export function makePrRefreshReader(statePath: () => string = defaultUiPrefsStatePath): () => number | undefined {
  let stamp: string | undefined
  let cached: number | undefined
  return () => {
    const file = statePath()
    let next: string
    try {
      const st = statSync(file)
      next = `${file}:${st.mtimeMs}:${st.size}`
    } catch {
      stamp = undefined
      cached = undefined
      return undefined
    }
    if (next === stamp) return cached
    stamp = next
    try {
      const raw = JSON.parse(readFileSync(file, "utf8")) as unknown
      const value =
        raw && typeof raw === "object" && !Array.isArray(raw)
          ? (raw as Record<string, unknown>)[PR_REFRESH_SECONDS_KEY]
          : undefined
      cached = normalizePrRefreshSeconds(value)
    } catch {
      cached = undefined
    }
    return cached
  }
}
