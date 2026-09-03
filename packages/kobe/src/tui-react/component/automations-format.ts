/**
 * Relative-time formatting shared by the two halves of the Routines page.
 *
 * Lives on its own so `automations-runs.tsx` can render a run's timestamp
 * without importing the page it renders inside — the page imports the runs
 * block, so the reverse edge would be a cycle.
 */

import { relativeBuckets } from "../../lib/relative-time"

/** `in 5m` / `12m ago` / a date once it is more than a day out. `\u2014` when
 *  the timestamp is missing or unparsable — an absence, never a fake "now". */
export function formatWhen(iso: string | undefined, now: number): string {
  if (!iso) return "—"
  const at = Date.parse(iso)
  if (!Number.isFinite(at)) return "—"
  const deltaMs = at - now
  const { minutes, hours } = relativeBuckets(Math.abs(deltaMs))
  if (minutes < 1) return deltaMs >= 0 ? "now" : "just now"
  if (minutes < 60) return deltaMs >= 0 ? `in ${minutes}m` : `${minutes}m ago`
  if (hours < 24) return deltaMs >= 0 ? `in ${hours}h` : `${hours}h ago`
  return new Date(at).toLocaleDateString()
}
