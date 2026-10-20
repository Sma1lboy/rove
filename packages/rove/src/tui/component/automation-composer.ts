/**
 * Framework-free state for the automation composer card (field order,
 * validation, schedule preview). A cron expression can't be checked by
 * reading it back, so the composer continuously answers "weekdays at 09:00 —
 * next Mon Aug 3, 09:00" instead of letting the daemon reject a typo later.
 * Fields and validation are in `automation-composer-core.ts`, the preview in
 * `cron-core.ts` (both shared with the web client); this file binds the preview
 * to the TUI's `t` and locale.
 */

import { intlLocale, t } from "@/tui/i18n"
import { type SchedulePreview, previewScheduleWith } from "./cron-core"

export {
  COMPOSER_FIELDS,
  type ComposerDraft,
  type ComposerField,
  EMPTY_DRAFT,
  canSubmitDraft,
  firstIncompleteField,
  nextComposerField,
} from "./automation-composer-core"
export type { SchedulePreview } from "./cron-core"

/** See {@link previewScheduleWith}. */
export function previewSchedule(expression: string, nowMs: number): SchedulePreview {
  return previewScheduleWith(expression, nowMs, t, intlLocale())
}
