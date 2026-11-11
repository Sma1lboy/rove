/**
 * Settings → Appearance: a sample under each task setting, drawn by the rail's and the pane's own parts, so a pick
 * shows what it changes at once (the dialog covers the real list).
 */

import type { RowStatus } from "rove-bridge/protocol"
import { useEngineIcons } from "./engine-icons.ts"
import { t } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { statusMark } from "./rail-glyphs.ts"
import { statusMarkStyle } from "./status-mark.ts"
import { useStore } from "./store.ts"
import { EngineIcon } from "./ui/engine-icon.tsx"
import { ROW_TITLE_RAIL, ROW_TITLE_RUNNING } from "./ui/row.ts"
import { SETTINGS_SAMPLE_PANE, SETTINGS_SAMPLE_ROW, SETTINGS_SAMPLE_ROWS } from "./ui/settings.ts"
import { PANE_WORKING } from "./ui/shell.ts"
import { StatusDots } from "./ui/status-dots.tsx"

/** `since: 0` = unknown, so a mark draws settled instead of replaying its entrance. */
const SAMPLES: readonly { readonly label: string; readonly status: RowStatus }[] = [
  { label: "settings.appearance.previewWorking", status: { kind: "running", since: 0 } },
  { label: "settings.appearance.previewDone", status: { kind: "unseen", since: 0 } },
  { label: "settings.appearance.previewIdle", status: { kind: "idle", since: 0 } },
  { label: "settings.appearance.previewWaiting", status: { kind: "needs-input", since: 0 } },
  { label: "settings.appearance.previewBroken", status: { kind: "attention", reason: "error", since: 0 } },
]

/** Task status: one sample row per state, marked as the rail marks it. */
export function StatusMarkSample({ model }: { model: AppModel }) {
  const style = useStore(statusMarkStyle)
  // Any engine's mark does: the sample shows how a mark is drawn, not which engine runs.
  const [icon] = [...useEngineIcons(model).values()]
  return (
    <span className={SETTINGS_SAMPLE_ROWS} aria-hidden="true">
      {SAMPLES.map(({ label, status }) => (
        <span key={label} className={SETTINGS_SAMPLE_ROW}>
          {style !== "dots" && <EngineIcon icon={icon} status={style === "engine" ? statusMark(status) : undefined} />}
          <span className="text-ink">{t(label)}</span>
          {style !== "engine" && <StatusDots status={status} />}
        </span>
      ))}
    </span>
  )
}

/** Running title: a working row's title. */
export function RunningTitleSample() {
  return (
    <span className={`${SETTINGS_SAMPLE_ROW} ${ROW_TITLE_RAIL} ${ROW_TITLE_RUNNING}`} aria-hidden="true">
      {t("settings.appearance.previewTitle")}
    </span>
  )
}

/** Working border: a small pane whose task is working. */
export function WorkingBorderSample() {
  return <span className={`${SETTINGS_SAMPLE_PANE} ${PANE_WORKING}`} aria-hidden="true" />
}
