/**
 * The words of the Settings screen are the TUI's: labels, hints and section copy come from its
 * `settings.*` catalog (and the tier names from `tasks.*`), so the two surfaces cannot drift or
 * disagree in either language. Only copy that describes the page itself lives in `en.ts`.
 */

import { en as settingsEn, zh as settingsZh } from "@sma1lboy/rove/src/tui/i18n/messages/settings.ts"
import { en as tasksEn, zh as tasksZh } from "@sma1lboy/rove/src/tui/i18n/messages/tasks.ts"
import { tFrom } from "./i18n/index.ts"

const SETTINGS = { en: settingsEn, zh: settingsZh }
const TASKS = { en: tasksEn, zh: tasksZh }

/** `settings.<key>` in the TUI catalog. */
export function ts(key: string, params?: Record<string, string | number>): string {
  return tFrom(SETTINGS, key, params)
}

/** `tasks.<key>` in the TUI catalog (tier names and descriptions). */
export function tt(key: string, params?: Record<string, string | number>): string {
  return tFrom(TASKS, key, params)
}
