/**
 * What marks a task row: the engine mark at the left in its brand colours with the 3×3 dots at the right for the
 * state (`both`), the mark alone carrying the state in its colour (`engine`), or the dots alone (`dots`). Kept in the daemon's state, so
 * every browser on it shows the same.
 */
import type { BridgeClient } from "./bridge.ts"
import { setPref, usePrefs } from "./prefs.ts"

export const STATUS_MARKS = ["both", "engine", "dots"] as const
export type StatusMarkStyle = (typeof STATUS_MARKS)[number]

/** A bridge from before the setting sends no value: the default. */
export function useStatusMarkStyle(): StatusMarkStyle {
  return usePrefs().prefs.statusMark ?? "both"
}

export function setStatusMarkStyle(client: BridgeClient, next: StatusMarkStyle): void {
  void setPref(client, "statusMark", next)
}
