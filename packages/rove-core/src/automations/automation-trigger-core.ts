/**
 * Shared display helpers for scheduled, event-driven, and hybrid routines,
 * used by the TUI and web Routines pages without duplicating formatting rules.
 */

import {
  type Automation,
  type AutomationTriggerMode,
  automationTriggerMode,
  formatEventTriggers,
} from "./automation-run-core.ts"
import { type Translate, describeCronWith } from "./cron-core.ts"

/** Compact trigger summary for list rows: cron expression/description, event triggers, or both. */
export function routineTriggerSubtitle(
  routine: Pick<Automation, "schedule" | "eventTriggers" | "webhook">,
  cronT?: Translate,
): string {
  const cronText = routine.schedule
    ? cronT
      ? (describeCronWith(routine.schedule, cronT) ?? routine.schedule)
      : routine.schedule
    : ""
  const eventsText = formatEventTriggers(routine)
  if (cronText && eventsText) return `${cronText} + ${eventsText}`
  if (eventsText) return `on ${eventsText}`
  return cronText
}

/** One-word mode badge key (`schedule`, `event`, `hybrid`). */
export function routineMode(
  routine: Pick<Automation, "schedule" | "eventTriggers" | "webhook">,
): AutomationTriggerMode {
  return automationTriggerMode(routine)
}

/** True when `routine` matches a list filter (`all`, `schedule`, or `event`). Hybrid matches both `schedule` and `event`. */
export function matchesRoutineFilter(
  routine: Pick<Automation, "schedule" | "eventTriggers" | "webhook">,
  filter: "all" | "schedule" | "event",
): boolean {
  if (filter === "all") return true
  const mode = automationTriggerMode(routine)
  if (filter === "schedule") return mode === "schedule" || mode === "hybrid"
  return mode === "event" || mode === "hybrid"
}

/** Webhook path shown in routine details when a routine accepts signed POSTs. */
export function routineWebhookPath(id: string): string {
  return `/hooks/routines/${id}`
}
