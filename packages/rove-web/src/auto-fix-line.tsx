/** The checks section's auto-fix line: the opt-in toggle for the daemon's fix-CI loop and where it stands (`1/3`). */

import type { TaskRow } from "rove-bridge/protocol"
import { t, useLocale } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { toast } from "./ui.ts"
import { Button } from "./ui/button.tsx"
import { TONE } from "./ui/tone.ts"

/** The daemon's attempt cap (`AUTO_FIX_MAX`, not importable here). */
const MAX = 3

export function AutoFixLine({ model, task }: { model: AppModel; task: TaskRow }) {
  useLocale()
  const state = task.autoFixCi
  const set = (enabled: boolean) =>
    void model.client
      .request("task.autoFixCi", { taskId: task.id, enabled })
      .catch((err) => toast(err instanceof Error ? err.message : String(err), "error"))
  return (
    <div className="flex items-center gap-3 px-2 pt-1 font-mono text-meta">
      {state ? (
        <>
          <span className={state.stopped ? TONE.attention : "text-muted"} title={t("files.autoFix.hint")}>
            {t(state.stopped ? "files.autoFix.stopped" : "files.autoFix.count", { n: state.attempts, max: MAX })}
          </span>
          <Button hit="tight" onClick={() => set(false)}>
            {t("files.autoFix.off")}
          </Button>
        </>
      ) : (
        <Button hit="tight" title={t("files.autoFix.hint")} onClick={() => set(true)}>
          {t("files.autoFix.on")}
        </Button>
      )}
    </div>
  )
}
