/**
 * Relative-time formatting shared by the two halves of the Routines page.
 *
 * Lives on its own so `automations-runs.tsx` can render a run's timestamp
 * without importing the page it renders inside — the page imports the runs
 * block, so the reverse edge would be a cycle.
 */

import { relativeBuckets } from "../../lib/relative-time"
import { intlLocale, t } from "../../tui/i18n"

/** `in 5m` / `12m ago` / a date once it is more than a day out. `\u2014` when
 *  the timestamp is missing or unparsable — an absence, never a fake "now".
 *  The date falls back on `Intl` for the UI locale, not the machine's. */
export function formatWhen(iso: string | undefined, now: number): string {
  if (!iso) return "—"
  const at = Date.parse(iso)
  if (!Number.isFinite(at)) return "—"
  const deltaMs = at - now
  const ahead = deltaMs >= 0
  const { minutes, hours } = relativeBuckets(Math.abs(deltaMs))
  if (minutes < 1) return t(ahead ? "automations.when.now" : "automations.when.justNow")
  if (minutes < 60) return t(ahead ? "automations.when.inMinutes" : "automations.when.minutesAgo", { n: minutes })
  if (hours < 24) return t(ahead ? "automations.when.inHours" : "automations.when.hoursAgo", { n: hours })
  return new Date(at).toLocaleDateString(intlLocale())
}

/** The daemon's run-status enum as display text; an unmapped status falls
 *  through to its raw value so a new one is loud rather than blank. */
export function formatRunStatus(status: string, translate: (key: string) => string): string {
  const key = `automations.runStatus.${status}`
  const label = translate(key)
  return label === key ? status : label
}
