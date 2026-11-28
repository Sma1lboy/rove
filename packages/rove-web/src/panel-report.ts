/**
 * Tells the daemon how this page's side panel is laid out (`ui.viewing`: `panel`, `panelOpen`,
 * `narrow`), so `rove api viewers` shows an agent what the human can see, and routes the bridge's
 * `panel` push (`rove api panel-show`) to the panel.
 */

import type { BridgeClient } from "./bridge.ts"
import { desktopBrowser } from "./desktop-browser.ts"
import { isNarrow, onNarrowChange } from "./layout.ts"
import type { AppModel } from "./model.ts"
import { isPanelPush, panelFields } from "./panel-contract.ts"
import { panelOpen } from "./panel-layout.ts"
import { applyPanelPush, focusDesktopBrowserTab, onPanelsChange, panelShown } from "./panel-state.ts"
import { newSession, page } from "./ui.ts"

export function watchPanel(model: AppModel, client: BridgeClient): void {
  // The panel of the task on screen, not the shared flag: an agent asking what the human sees gets this task's.
  model.viewingExtras = () => panelFields({ narrow: isNarrow(), panelOpen: panelShown(model.selection.get().taskId) })
  const report = () => model.reportViewing()
  panelOpen.subscribe(report)
  onPanelsChange(report)
  newSession.subscribe(report)
  page.subscribe(report)
  onNarrowChange(report)
  client.on("panel", (data) => {
    if (isPanelPush(data)) applyPanelPush(data, model.selection.get().taskId)
  })
  const desktop = desktopBrowser()
  if (desktop) {
    const show = (opts: { id: string; taskId?: string; panelKey?: string; url: string }) => {
      const targetTaskId = opts.taskId ?? model.selection.get().taskId
      if (!targetTaskId || !opts.url) return
      focusDesktopBrowserTab({ taskId: targetTaskId, desktopTabId: opts.id, panelKey: opts.panelKey, url: opts.url })
    }
    desktop.onHandoff((event) => {
      if (event.owner === "human") show(event)
    })
    desktop.onFocus((info) => show(info))
  }
}
