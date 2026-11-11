/**
 * Tells someone who used Rove before the engine marks, once, that task rows look different now and how to get the
 * old look back. The daemon remembers it was said, so a second computer on the same daemon stays quiet. A daemon
 * with no task yet belongs to someone new, who has nothing to compare with and is told nothing.
 */

import { useEffect } from "react"
import { t } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { setPref, usePrefs } from "./prefs.ts"
import { setStatusMarkStyle, useStatusMarkStyle } from "./status-mark.ts"
import { toast } from "./ui.ts"

/** Long enough to read it and decide; a click on the card closes it sooner. */
const NOTICE_MS = 20_000

/** `taskCount` is undefined until the first task list arrives. */
export function useStatusMarkNotice(model: AppModel, taskCount: number | undefined): void {
  // Strictly false: the default and a bridge from before the setting both read as "nothing to say".
  const owed = usePrefs().prefs.statusMarkNoticeSeen === false
  const style = useStatusMarkStyle()
  useEffect(() => {
    if (!owed || taskCount === undefined) return
    void setPref(model.client, "statusMarkNoticeSeen", true)
    if (taskCount === 0 || style === "dots") return
    toast(
      t("rail.markNotice"),
      "info",
      { label: t("rail.markNoticeUndo"), run: () => setStatusMarkStyle(model.client, "dots") },
      NOTICE_MS,
    )
  }, [model, owed, taskCount, style])
}
