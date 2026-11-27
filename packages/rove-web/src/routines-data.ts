/** What `routine.list` answers, as the Routines page reads it. */

import {
  type Automation,
  type AutomationRunStatus,
  automationRunNeedsAttention,
} from "@sma1lboy/rove/src/tui/component/automation-run-core.ts"
import { fill } from "./pages-kit.ts"

export interface RoutinesReply {
  readonly automations: readonly Automation[]
  readonly keepsDaemonAlive: boolean
  readonly lastRunStatus?: Readonly<Record<string, AutomationRunStatus>>
  /** The newest failure among recent runs; absent when none failed (or an older daemon). */
  readonly lastFailure?: Readonly<Record<string, { readonly at: string; readonly reason: string }>>
}

/** Whether a routine's last run wants a human: the page's "needs you" group and the phone button's count. */
export function routineNeedsYou(reply: Pick<RoutinesReply, "lastRunStatus"> | null, id: string): boolean {
  const status = reply?.lastRunStatus?.[id]
  return status !== undefined && automationRunNeedsAttention(status)
}

type WhenCopy = Record<"now" | "justNow" | "inMinutes" | "minutesAgo" | "inHours" | "hoursAgo", string>

/** A run time against `now`, in the page's words: `in 25m`, `3h ago`, a date past a day. */
export function whenText(copy: WhenCopy, now: number): (iso: string | undefined) => string {
  return (iso) => {
    const time = iso ? Date.parse(iso) : Number.NaN
    if (!Number.isFinite(time)) return "—"
    const delta = time - now
    const ahead = delta >= 0
    const minutes = Math.floor(Math.abs(delta) / 60_000)
    const hours = Math.floor(minutes / 60)
    if (minutes < 1) return ahead ? copy.now : copy.justNow
    if (minutes < 60) return fill(ahead ? copy.inMinutes : copy.minutesAgo, { n: minutes })
    if (hours < 24) return fill(ahead ? copy.inHours : copy.hoursAgo, { n: hours })
    return new Date(time).toLocaleDateString()
  }
}
