/** The workspace's top-right buttons, one per kind of view: each opens or closes its own column of the side panel, and reads as on while that column is showing. Chat opens from the transcript search instead. */

import { t, useLocale } from "./i18n/index.ts"
import { LAUNCHED_KINDS } from "./panel-layout.ts"
import { columnOf } from "./panel-model.ts"
import { launchPanel, usePanelShown, useTaskPanel } from "./panel-state.ts"
import { ICONS, Icon } from "./panel-tabs.tsx"
import { useStore } from "./store.ts"
import { zen } from "./ui.ts"
import { PANEL_LAUNCH, iconButton } from "./ui/panel.ts"

export function PanelLauncher({ taskId }: { taskId: string }) {
  useLocale()
  const panel = useTaskPanel(taskId)
  const zenOn = useStore(zen)
  const shown = usePanelShown(taskId) && !zenOn
  return (
    <div className={PANEL_LAUNCH}>
      {LAUNCHED_KINDS.map((kind) => {
        const on = shown && !!columnOf(panel, kind)
        return (
          <button
            type="button"
            key={kind}
            className={iconButton({ on })}
            title={t(`panel.${kind}`)}
            aria-label={t(`panel.${kind}`)}
            aria-pressed={on}
            onClick={() => launchPanel(taskId, kind)}
          >
            <Icon>{ICONS[kind]}</Icon>
          </button>
        )
      })}
    </div>
  )
}
