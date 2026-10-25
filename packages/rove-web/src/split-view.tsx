/**
 * A tab's split panes (TUI `TerminalSplit`): each pane is its own hosted session, laid out from
 * the tree the server keeps (`tab.split` edits it). Right/down splits, F3 cycles focus, the
 * prefix `w` and F2 act on the active pane while split. Panes are positioned flat, so a pane
 * never remounts (and replays) when a sibling is added around it.
 */

import { useEffect } from "react"
import type { SplitView, TabRow } from "rove-bridge/protocol"
import { registerCommands } from "./commands.ts"
import { TextDialog } from "./dialogs.tsx"
import { t } from "./i18n/index.ts"
import { terminalText } from "./keymap-text.ts"
import type { AppModel } from "./model.ts"
import { usePrefs } from "./prefs.ts"
import { tabLabel } from "./rail-view.tsx"
import { type LeafBox, cycleLeaf, isSplit, layoutSplit, leafNames, leafSignature, leavesOf } from "./split-model.ts"
import { createStore, useStore } from "./store.ts"
import { termFor } from "./term-control.ts"
import { streamKey } from "./term-mount.ts"
import type { EngineExit } from "./term-notice.tsx"
import { TerminalView } from "./terminal-view.tsx"
import { dialog, toast } from "./ui.ts"

/** Local focus per tab, tied to the pane set it was chosen in (the server's `activeLeafId` seeds a new one). */
const activeLeaves = createStore<Readonly<Record<string, { readonly sig: string; readonly leaf: string }>>>({})

function activeLeafOf(taskId: string, tab: TabRow, split: SplitView): string {
  const saved = activeLeaves.get()[`${taskId}::${tab.id}`]
  return saved && saved.sig === leafSignature(split) && leavesOf(split.root).some((l) => l.id === saved.leaf)
    ? saved.leaf
    : split.activeLeafId
}

function setActiveLeaf(taskId: string, tabId: string, split: SplitView, leaf: string): void {
  activeLeaves.set({ ...activeLeaves.get(), [`${taskId}::${tabId}`]: { sig: leafSignature(split), leaf } })
}

function selectedTab(model: AppModel): { taskId: string; tab: TabRow } | null {
  const { taskId, tabId } = model.selection.get()
  const tab = taskId ? model.tabs.get()[taskId]?.find((row) => row.id === tabId) : undefined
  return taskId && tab ? { taskId, tab } : null
}

interface SplitReply {
  readonly leaf: string
  readonly changed: boolean
  readonly split: SplitView | null
}

/** One server edit, then the new layout in hand: `after` runs with the reply once the tab list has caught up. */
async function editSplit(
  model: AppModel,
  args: Record<string, unknown>,
  after?: (reply: SplitReply) => void,
): Promise<void> {
  try {
    const reply = await model.client.request<SplitReply>("tab.split", args)
    await model.refreshTabsNow()
    after?.(reply)
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err), "error")
  }
}

function open(model: AppModel, direction: "right" | "down"): void {
  const at = selectedTab(model)
  if (!at) return
  const { taskId, tab } = at
  const from = tab.split ? activeLeafOf(taskId, tab, tab.split) : "leaf-1"
  const size = termFor(streamKey(taskId, tab.id, from))?.size()
  void editSplit(model, { taskId, tabId: tab.id, action: "open", direction, leafId: from, ...size }, (reply) => {
    if (!reply.changed) toast(t("layout.splitTooSmall"), "error")
    else if (reply.split) setActiveLeaf(taskId, tab.id, reply.split, reply.leaf)
  })
}

function closeActive(model: AppModel): void {
  const at = selectedTab(model)
  const split = at?.tab.split
  if (!at || !split) return
  const { taskId, tab } = at
  void editSplit(
    model,
    { taskId, tabId: tab.id, action: "close", leafId: activeLeafOf(taskId, tab, split) },
    (reply) => reply.split && setActiveLeaf(taskId, tab.id, reply.split, reply.split.activeLeafId),
  )
}

function renameActive(model: AppModel): void {
  const at = selectedTab(model)
  const split = at?.tab.split
  if (!at || !split) return
  const { taskId, tab } = at
  const leaf = activeLeafOf(taskId, tab, split)
  dialog.set(
    <TextDialog
      title={terminalText("split.renameTitle")}
      initial={leafNames(split, tabLabel(tab)).get(leaf) ?? ""}
      allowEmpty
      submitLabel={t("dialog.save")}
      onSubmit={(title) => editSplit(model, { taskId, tabId: tab.id, action: "rename", leafId: leaf, title })}
    />,
  )
}

const hasTab = (model: AppModel): boolean => selectedTab(model) !== null
const splitNow = (model: AppModel): boolean => isSplit(selectedTab(model)?.tab.split)

registerCommands(() => [
  {
    id: "workspace.split.right",
    chords: ["ctrl+\\"],
    prefix: false,
    surface: "workspace",
    live: hasTab,
    run: (m) => open(m, "right"),
  },
  {
    id: "workspace.split.down",
    chords: ["ctrl+="],
    prefix: false,
    surface: "workspace",
    live: hasTab,
    run: (m) => open(m, "down"),
  },
  {
    id: "workspace.split.focus-next",
    chords: ["f3"],
    prefix: false,
    surface: "workspace",
    live: splitNow,
    run: (model) => {
      const at = selectedTab(model)
      if (!at?.tab.split) return
      const next = cycleLeaf(at.tab.split, activeLeafOf(at.taskId, at.tab, at.tab.split))
      setActiveLeaf(at.taskId, at.tab.id, at.tab.split, next)
      termFor(streamKey(at.taskId, at.tab.id, next))?.focus()
    },
  },
  { id: "workspace.split.close", chords: ["w"], prefix: true, surface: "workspace", live: splitNow, run: closeActive },
  {
    id: "workspace.split.rename",
    chords: ["f2"],
    prefix: false,
    surface: "workspace",
    live: splitNow,
    run: renameActive,
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
          {several && <span className="split-name">{names.get(box.id)}</span>}
        </div>
      ))}
    </div>
  )
}
