/**
 * The one-shot delayed start (New session's "later"): reading the time a person types, showing it back, and
 * asking the daemon to hold the first message until then (`task.scheduleStart`).
 */

import type { BridgeClient } from "./bridge.ts"

const MINUTE = 60_000

/** `H:MM`, `HH:MM`, or `9pm` / `9:30 am`, after an optional `today` / `tomorrow` (`今天` / `明天`). */
const CLOCK = /^(?:(today|tomorrow|今天|明天)\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i
const AFTER = /^\+\s*(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?$/i

/**
 * The moment `text` names, in `now`'s local time, or null when it names none or one that has passed.
 * `+30m` / `+2h` / `+1h30m` count from now; a bare clock time is its next occurrence (tomorrow when today's has
 * gone); `today` insists on today and `tomorrow` on tomorrow.
 */
export function parseStartAt(text: string, now: Date): Date | null {
  const input = text.trim()
  const after = AFTER.exec(input)
  if (after && (after[1] || after[2])) {
    const minutes = Number(after[1] ?? 0) * 60 + Number(after[2] ?? 0)
    return minutes > 0 ? new Date(now.getTime() + minutes * MINUTE) : null
  }
  const clock = CLOCK.exec(input)
  if (!clock) return null
  const day = clock[1]?.toLowerCase()
  let hour = Number(clock[2])
  const minute = Number(clock[3] ?? 0)
  const meridiem = clock[4]?.toLowerCase()
  if (meridiem) {
    if (hour < 1 || hour > 12) return null
    hour = (hour % 12) + (meridiem === "pm" ? 12 : 0)
  }
  if (hour > 23 || minute > 59) return null
  const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute)
  const tomorrow = day === "tomorrow" || day === "明天"
  if (tomorrow) at.setDate(at.getDate() + 1)
  else if (at.getTime() <= now.getTime()) {
    if (day) return null
    at.setDate(at.getDate() + 1)
  }
  return at.getTime() > now.getTime() ? at : null
}

/** `22:30` for today, `Sat 09:00` for another day, in the browser's own locale and clock. */
export function formatStartsAt(at: Date, now: Date = new Date()): string {
  const time = at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  if (at.toDateString() === now.toDateString()) return time
  return `${at.toLocaleDateString([], { weekday: "short" })} ${time}`
}

/** Holds `prompt` for the task `taskId` (created unstarted) until `at`; the daemon starts it then, restarts included. */
export async function scheduleCreated(client: BridgeClient, taskId: string, at: Date, prompt: string): Promise<void> {
  await client.request("task.scheduleStart", { taskId, at: at.toISOString(), prompt })
}
