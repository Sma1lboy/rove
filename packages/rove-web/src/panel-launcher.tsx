/** The workspace's top-right buttons that open the side panel on Files, a Diff or a Browser; the one on screen is tinted, and pressing it again closes the panel. */

import { t, useLocale } from "./i18n/index.ts"
import { PANEL_KINDS, panelOpen } from "./panel-layout.ts"
import { shownKind } from "./panel-model.ts"
import { launchPanel, useTaskPanel } from "./panel-state.ts"
import { ICONS, Icon } from "./panel-tabs.tsx"
import { useStore } from "./store.ts"
import { zen } from "./ui.ts"
import { PANEL_LAUNCH, iconButton } from "./ui/panel.ts"

export function PanelLauncher({ taskId }: { taskId: string }) {
  useLocale()
  const panel = useTaskPanel(taskId)
  const shown = useStore(panelOpen)
  const zenOn = useStore(zen)
  const on = shown && !zenOn ? shownKind(panel) : null
  return (
    <div className={PANEL_LAUNCH}>
      {PANEL_KINDS.map((kind) => (
        <button
          type="button"
          key={kind}
          className={iconButton({ on: on === kind })}
          title={t(`panel.${kind}`)}
          aria-label={t(`panel.${kind}`)}
          aria-pressed={on === kind}
          onClick={() => launchPanel(taskId, kind)}
        >
          <Icon>{ICONS[kind]}</Icon>
        </button>
      ))}
    </div>
  )
}
