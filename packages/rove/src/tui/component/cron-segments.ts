/**
 * A cron expression as five editable segments: ←/→ moves, ↑/↓ changes the one
 * under the cursor, so structure is visible and every edit legal by
 * construction. The ladders and edits live in `cron-core.ts` (shared with the
 * web client); this file binds the description to the TUI's `t`.
 */

import { describeCronWith } from "@sma1lboy/rove-core/automations/cron-core.ts"
import { t } from "@sma1lboy/rove-core/i18n/index.ts"

export {
  CRON_SEGMENTS,
  type CronSegment,
  DOW_CODES,
  joinCron,
  ladderFor,
  moveSegmentCursor,
  setSegment,
  splitCron,
  stepSegment,
} from "@sma1lboy/rove-core/automations/cron-core.ts"

/** See {@link describeCronWith}. */
export function describeCron(expression: string): string | null {
  return describeCronWith(expression, t)
}
