/**
 * Framework-free state for the automation composer card (field order,
 * validation, schedule preview). A cron expression can't be checked by
 * reading it back, so the composer continuously answers "weekdays at 09:00 —
 * next Mon Aug 3, 09:00" instead of letting the daemon reject a typo later.
 * Fields and validation are in `automation-composer-core.ts`, the preview in
 * `cron-core.ts` (both shared with the web client); this file binds the preview
 * to the TUI's `t` and locale.
 */

import { type SchedulePreview, previewScheduleWith } from "@sma1lboy/rove-core/automations/cron-core.ts"
import { intlLocale, t } from "@sma1lboy/rove-core/i18n/index.ts"

export {
  AUTOMATION_EVENT_KINDS,
  COMPOSER_FIELDS,
  type AutomationEventKind,
  type AutomationEventTrigger,
  type ComposerDraft,
  type ComposerField,
  type ComposerTriggerMode,
  EMPTY_DRAFT,
  buildEventTriggerFromDraft,
  canSubmitDraft,
  draftTriggerMode,
  firstIncompleteField,
  nextComposerField,
} from "@sma1lboy/rove-core/automations/automation-composer-core.ts"
export type { SchedulePreview } from "@sma1lboy/rove-core/automations/cron-core.ts"

/** See {@link previewScheduleWith}. */
export function previewSchedule(expression: string, nowMs: number): SchedulePreview {
  return previewScheduleWith(expression, nowMs, t, intlLocale())
}
