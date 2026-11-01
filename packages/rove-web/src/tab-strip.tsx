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
  // `chat.tabStrip.mode` hides the session tabs (the rail tree lists them); the panel launcher stays.
  const hidden = !tabStripVisible(prefs.tabStrip, tabs.length)
  return (
    <div
      className="flex min-w-0 items-center gap-0.5 font-mono text-meta transition-padding-left duration-220 ease-snap motion-reduce:transition-none rail-folded:min-h-6.5 rail-folded:pl-23"
      role="tablist"
    >
      {tabs.map((tab, i) => (
        <button
          type="button"
          role="tab"
          key={tab.id}
          aria-selected={tab.id === selection.tabId}
          className={`group/tab flex items-center gap-1.5 whitespace-nowrap rounded-sm px-2.5 py-1 active:scale-97 motion-reduce:active:scale-none touch:select-none touch:touch-callout-none ${hidden ? "hidden" : ""} ${tab.id === selection.tabId ? "bg-inset text-ink" : "text-muted hover:bg-hover data-menu-open:bg-hover"}`}
          onClick={() => model.select(task.id, tab.id)}
          onContextMenu={(e) => openMenu(e, taskMenu(model, task, tab))}
        >
          <span className="text-subtle group-aria-selected/tab:text-accent">{i + 1}</span>
          {tabLabel(tab)}
        </button>
      ))}
      {!narrow && <PanelLauncher taskId={task.id} />}
    </div>
  )
}
