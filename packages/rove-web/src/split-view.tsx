/**
 * A tab's split panes (TUI `TerminalSplit`): each pane is its own hosted session, laid out from
 * the tree the server keeps (`tab.split` edits it). Right/down splits, F3 cycles focus, the
 * prefix `w` and F2 act on the active pane while split. Panes are positioned flat, so a pane
 * never remounts (and replays) when a sibling is added around it.
 */

import { useEffect } from "react"
import type { SplitView, TabRow } from "rove-bridge/protocol"
import { registerCommands } from "./commands.ts"
import type { AppModel } from "./model.ts"
import { usePrefs } from "./prefs.ts"
import { openMenu } from "./rail-view.tsx"
import { tabLabel } from "./rail.ts"
import {
  activeLeafOf,
  activeLeaves,
  closeLeaf,
  editSplit,
  focusLeaf,
  renameLeaf,
  selectedTab,
  setActiveLeaf,
  splitLeaf,
  splitMenu,
} from "./split-actions.tsx"
import { type LeafBox, cycleLeaf, isSplit, layoutSplit, leafNames } from "./split-model.ts"
import { useStore } from "./store.ts"
import type { EngineExit } from "./term-notice.tsx"
import { TerminalView } from "./terminal-view.tsx"

const hasTab = (model: AppModel): boolean => selectedTab(model) !== null
const splitNow = (model: AppModel): boolean => isSplit(selectedTab(model)?.tab.split)

/** The selected tab's active pane, while the tab is split. */
function activePane(model: AppModel): { taskId: string; tab: TabRow; split: SplitView; leaf: string } | null {
  const at = selectedTab(model)
  const split = at?.tab.split
  return at && split ? { ...at, split, leaf: activeLeafOf(at.taskId, at.tab, split) } : null
}

registerCommands(() => [
  {
    id: "workspace.split.right",
    chords: ["ctrl+\\"],
    prefix: false,
    surface: "workspace",
    live: hasTab,
    run: (model) => {
      const at = selectedTab(model)
      if (at) splitLeaf(model, at.taskId, at.tab, "right")
    },
  },
  {
    id: "workspace.split.down",
    chords: ["ctrl+="],
    prefix: false,
    surface: "workspace",
    live: hasTab,
    run: (model) => {
      const at = selectedTab(model)
      if (at) splitLeaf(model, at.taskId, at.tab, "down")
    },
  },
  {
    id: "workspace.split.focus-next",
    chords: ["f3"],
    prefix: false,
    surface: "workspace",
    live: splitNow,
    run: (model) => {
      const at = activePane(model)
      if (at) focusLeaf(at.taskId, at.tab, at.split, cycleLeaf(at.split, at.leaf))
    },
  },
  {
    id: "workspace.split.close",
    chords: ["w"],
    prefix: true,
    surface: "workspace",
    live: splitNow,
    run: (model) => {
      const at = activePane(model)
      if (at) closeLeaf(model, at.taskId, at.tab, at.leaf)
    },
  },
  {
    id: "workspace.split.rename",
    chords: ["f2"],
    prefix: false,
    surface: "workspace",
    live: splitNow,
    run: (model) => {
      const at = activePane(model)
      if (at) renameLeaf(model, at.taskId, at.tab, at.leaf)
    },
  },
])

const WHOLE: readonly LeafBox[] = [{ id: "leaf-1", x: 0, y: 0, w: 1, h: 1, left: false, top: false }]

/** A tab is always laid out as panes: an unsplit one is the single `leaf-1`, so splitting never remounts its terminal. */
export function SplitPane({ model, taskId, tab }: { model: AppModel; taskId: string; tab: TabRow }) {
  const split = tab.split
  useStore(activeLeaves) // a focus change re-renders; `activeLeafOf` reads it
  const active = split ? activeLeafOf(taskId, tab, split) : "leaf-1"
  const names = split ? leafNames(split, tabLabel(tab)) : new Map<string, string>()
  const several = isSplit(split)
  const { prefs } = usePrefs()
  // The daemon marks an engine tab dead when its engine ended and only the fallback shell is left.
  // Read from the task's live `tabStatus` push: the tab row's own `status` is a snapshot of the last tab fetch.
  const liveStatus = useStore(model.tasks)?.tasks.find((row) => row.id === taskId)?.tabStatus?.[tab.id] ?? tab.status
  const deadSince = tab.kind === "engine" && liveStatus?.reason === "dead" ? liveStatus.since : null
  // The exit code rides the tab fetch, which may predate the death.
  useEffect(() => {
    if (deadSince !== null) void model.refreshTabsNow()
  }, [deadSince, model])
  const engineExit: EngineExit | null =
    deadSince !== null && tab.alive !== false ? { code: tab.exit?.code ?? null, since: deadSince } : null
  return (
    <div className={`split ${several ? `is-${prefs.splitStyle}` : ""}`}>
      {(split ? layoutSplit(split.root) : WHOLE).map((box) => (
        <div
          key={box.id}
          className={`split-leaf ${box.left ? "has-left" : ""} ${box.top ? "has-top" : ""} ${box.id === active ? "is-active" : ""}`}
          style={{
            left: `calc(${box.x * 100}% + var(--ml, 0px))`,
            top: `calc(${box.y * 100}% + var(--mt, 0px))`,
            width: `calc(${box.w * 100}% - var(--ml, 0px))`,
            height: `calc(${box.h * 100}% - var(--mt, 0px))`,
          }}
        >
          <TerminalView
            client={model.client}
            model={model}
            engineExit={box.id === "leaf-1" ? engineExit : null}
            taskId={taskId}
            tabId={tab.id}
            leafId={box.id}
            focused={box.id === active}
            onActivate={() => split && setActiveLeaf(taskId, tab.id, split, box.id)}
            onExit={() => {
              if (several) void editSplit(model, { taskId, tabId: tab.id, action: "close", leafId: box.id })
              // A command tab (shell, editor, plugin pane) ends with its process, as in the TUI.
              else if (tab.kind !== "engine") {
                void model.client
                  .request("tab.close", { taskId, tabId: tab.id })
                  .then(() => model.refreshTabsNow())
                  .catch(() => {})
              }
            }}
          />
          {several && (
            <span className="split-name" onContextMenu={(e) => openMenu(e, splitMenu(model, taskId, tab, box.id))}>
              {names.get(box.id)}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
