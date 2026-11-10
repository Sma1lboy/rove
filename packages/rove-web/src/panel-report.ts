/**
 * Tells the daemon how this page's side panel is laid out (`ui.viewing`: `panel`, `panelOpen`,
 * `narrow`), so `rove api viewers` shows an agent what the human can see, and routes the bridge's
 * `panel` push (`rove api panel-show`) to the panel.
 */

import type { BridgeClient } from "./bridge.ts"
import { isNarrow, onNarrowChange } from "./layout.ts"
import type { AppModel } from "./model.ts"
import { isPanelPush, panelFields } from "./panel-contract.ts"
import { panelOpen } from "./panel-layout.ts"
import { applyPanelPush } from "./panel-state.ts"
import { zen } from "./ui.ts"

export function watchPanel(model: AppModel, client: BridgeClient): void {
  model.viewingExtras = () => panelFields({ narrow: isNarrow(), panelOpen: panelOpen.get(), zen: zen.get() })
  const report = () => model.reportViewing()
  panelOpen.subscribe(report)
  zen.subscribe(report)
  onNarrowChange(report)
  client.on("panel", (data) => {
    if (isPanelPush(data)) applyPanelPush(data, model.selection.get().taskId)
  })
}
