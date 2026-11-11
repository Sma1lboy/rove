/**
 * Tells someone who used Rove before the engine marks, once, that task rows look different now and how to get the
 * old look back. A first-time browser has nothing to compare with and is told nothing.
 */

import { useEffect } from "react"
import { t } from "./i18n/index.ts"
import { STATUS_MARK_KEY, setStatusMarkStyle } from "./status-mark.ts"
import { toast } from "./ui.ts"

const SEEN_KEY = "rove.statusMarkNoticeSeen"
/** Long enough to read it and decide; a click on the card closes it sooner. */
const NOTICE_MS = 20_000

/** Read at load, before this page writes anything: any Rove key from an earlier visit, and no pick of a mark yet. */
const owed =
  localStorage.getItem(SEEN_KEY) === null &&
  localStorage.getItem(STATUS_MARK_KEY) === null &&
  Object.keys(localStorage).some((key) => key.startsWith("rove."))

let told = false

/** `listed` = the task list is on screen, so the notice has something to point at. */
export function useStatusMarkNotice(listed: boolean): void {
  useEffect(() => {
    if (!listed || !owed || told) return
    told = true
    localStorage.setItem(SEEN_KEY, "1")
    toast(
      t("rail.markNotice"),
      "info",
      { label: t("rail.markNoticeUndo"), run: () => setStatusMarkStyle("dots") },
      NOTICE_MS,
    )
  }, [listed])
}
