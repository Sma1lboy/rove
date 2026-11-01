/** Toast the boot-time skill notice (`lib/skill-nudge.ts`) once the host is up. */

import { useEffect } from "react"
import { useOptionalNotifications } from "../context/notifications"
import { t } from "../i18n"

export function useSkillNudge(engines: readonly string[] | null): void {
  const notif = useOptionalNotifications()
  // biome-ignore lint/correctness/useExhaustiveDependencies: decided once at boot; shown once.
  useEffect(() => {
    if (!notif || !engines || engines.length === 0) return
    notif.notify({
      taskId: "",
      tabId: "",
      kind: "needs_input",
      title: t("settings.engines.skill.nudgeTitle"),
      body: t("settings.engines.skill.nudgeBody", { engines: engines.join(", ") }),
    })
  }, [])
}
