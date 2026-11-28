import { tabStripVisible } from "@sma1lboy/rove-core/state/tab-strip.ts"
import type { TabRow, TaskRow } from "rove-bridge/protocol"
import { engineColorForPack } from "./appearance/apply.ts"
import { AppearanceSlot } from "./appearance/declarative.tsx"
import { useActiveAppearancePack } from "./appearance/runtime.ts"
import { t } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { PanelLauncher } from "./panel-launcher.tsx"
import { usePrefs } from "./prefs.ts"
import { openMenu } from "./rail-view.tsx"
import { tabLabel } from "./rail.ts"
import { taskMenu } from "./row-actions.tsx"
import { useStore } from "./store.ts"
import { useMode } from "./task-colors.ts"
import { tuckRare } from "./ui.ts"
import { TAB_STRIP } from "./ui/panel.ts"

/** The open task's tabs as a tablist; on a wide screen the buttons that open the side panel sit at its end. */
export function TabStrip({
  model,
  task,
  tabs,
  narrow,
}: { model: AppModel; task: TaskRow; tabs: readonly TabRow[]; narrow: boolean }) {
  const selection = useStore(model.selection)
  const { prefs } = usePrefs()
  const pack = useActiveAppearancePack()
  const mode = useMode()
  // `chat.tabStrip.mode` hides the session tabs (the rail tree lists them); the panel launcher stays.
  const hidden = !tabStripVisible(prefs.tabStrip, tabs.length)
  const defaultStrip = (
    <div className={TAB_STRIP} role="tablist">
      {tabs.map((tab, i) => (
        <button
          type="button"
          role="tab"
          key={tab.id}
          aria-selected={tab.id === selection.tabId}
          className={`group/tab flex items-center gap-1.5 whitespace-nowrap rounded-sm px-2.5 py-1 active:scale-97 motion-reduce:active:scale-none touch:select-none touch:touch-callout-none ${hidden ? "hidden" : ""} ${tab.id === selection.tabId ? "bg-inset text-ink" : "text-muted hover:bg-hover data-menu-open:bg-hover"}`}
          onClick={() => model.select(task.id, tab.id)}
          onContextMenu={(e) => openMenu(e, tuckRare(taskMenu(model, task, tab), t("menu.more")))}
        >
          <span className="text-subtle group-aria-selected/tab:text-accent">{i + 1}</span>
          {tabLabel(tab)}
        </button>
      ))}
      {!narrow && <PanelLauncher taskId={task.id} />}
    </div>
  )
  const activeTab = tabs.find((tab) => tab.id === selection.tabId)
  return (
    <AppearanceSlot
      slot="session.header"
      data={{
        taskId: task.id,
        title: task.label,
        branch: task.branch || undefined,
        repo: task.repo ? task.repo.split("/").pop() : undefined,
        engineId: task.engine?.id ?? undefined,
        engineName: task.engine?.name,
        engineColor: engineColorForPack(pack?.manifest, task.engine?.id ?? undefined, mode),
        statusKind: task.rowStatus?.kind ?? "idle",
        tabs: tabs.map((tab) => ({ id: tab.id, label: tabLabel(tab), active: tab.id === selection.tabId })),
        activeTab: activeTab ? tabLabel(activeTab) : undefined,
        tabCount: tabs.length,
        onSelectTab: (tabId) => model.select(task.id, tabId),
      }}
      fallback={defaultStrip}
    />
  )
}
