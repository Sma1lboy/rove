import { tabStripVisible } from "@sma1lboy/rove/src/state/tab-strip.ts"
import type { TabRow, TaskRow } from "rove-bridge/protocol"
import type { AppModel } from "./model.ts"
import { PanelLauncher } from "./panel-launcher.tsx"
import { usePrefs } from "./prefs.ts"
import { openMenu } from "./rail-view.tsx"
import { tabLabel } from "./rail.ts"
import { taskMenu } from "./row-actions.tsx"
import { useStore } from "./store.ts"

/** The open task's tabs as a tablist; on a wide screen the buttons that open the side panel sit at its end. */
export function TabStrip({
  model,
  task,
  tabs,
  narrow,
}: { model: AppModel; task: TaskRow; tabs: readonly TabRow[]; narrow: boolean }) {
  const selection = useStore(model.selection)
  const { prefs } = usePrefs()
  return (
    <div className={`tab-strip ${tabStripVisible(prefs.tabStrip, tabs.length) ? "" : "is-tabs-hidden"}`} role="tablist">
      {tabs.map((tab, i) => (
        <button
          type="button"
          role="tab"
          key={tab.id}
          aria-selected={tab.id === selection.tabId}
          className={`tab ${tab.id === selection.tabId ? "is-active" : ""}`}
          onClick={() => model.select(task.id, tab.id)}
          onContextMenu={(e) => openMenu(e, taskMenu(model, task, tab))}
        >
          <span className="tab-index">{i + 1}</span>
          {tabLabel(tab)}
        </button>
      ))}
      {!narrow && <PanelLauncher taskId={task.id} />}
    </div>
  )
}
