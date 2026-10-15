/**
 * The TUI's direct chords (`keybindings-chat.ts` and friends): Ctrl+1..9 jump to a tab,
 * Ctrl+] / Ctrl+[ cycle, Ctrl+E opens the new-conversation picker, F2 renames the tab, F1
 * help, F4 next pane, and every other non-prefix command a module registered (splits,
 * terminal scroll, F5) and (global) F7, the next Inbox episode. One capture-phase listener runs the registry, so xterm can't take
 * a chord first and the palette runs exactly what the key would. Inactive while a dialog
 * is open or a text field has focus. A browser that reserves a chord (Ctrl+1..9 off macOS,
 * Ctrl+W/T/N) never delivers it, which is the browser's call, not the page's.
 */

import { useEffect } from "react"
import { type WebCommand, allCommands, appliesOn, currentSurface, registerCommands, specificity } from "./commands.ts"
import { TextDialog } from "./dialogs.tsx"
import { openHelp } from "./help-view.tsx"
import { t } from "./i18n/index.ts"
import { openRoutineEpisode } from "./inbox-open.ts"
import { isRoutineState, nextAttention } from "./inbox.ts"
import type { AppModel } from "./model.ts"
import { NewChatDialog } from "./new-chat-dialog.tsx"
import { focusPane } from "./pane-focus.ts"
import { tabLabel } from "./rail-view.tsx"
import { isSplit } from "./split-model.ts"
import { dialog, page, preview, toast } from "./ui.ts"

function typingInField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  // xterm's own textarea is the terminal, not a field.
  if (target.closest(".xterm")) return false
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
}

/** Enter in the rail opens a row; in an empty pane it starts a conversation. */
function inRail(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest(".rail, button, a")
}

/** A keypress as `RoveKeymap` spells it: `ctrl+e`, `f4`, `ctrl+pageup`. */
function chordOf(e: KeyboardEvent): string {
  const key = e.key.toLowerCase()
  const name = key.startsWith("arrow") ? key.slice(5) : key
  return `${e.ctrlKey ? "ctrl+" : ""}${e.shiftKey && e.key.length > 1 ? "shift+" : ""}${name}`
}

const tabsOf = (model: AppModel) => model.tabs.get()[model.selection.get().taskId ?? ""] ?? []

function current(model: AppModel) {
  const { taskId, tabId } = model.selection.get()
  const tabs = tabsOf(model)
  return { taskId, tabs, at: tabs.findIndex((tab) => tab.id === tabId) }
}

function go(model: AppModel, index: number): void {
  const { taskId, tabs } = current(model)
  const tab = tabs[index]
  if (!taskId || !tab) return
  preview.set(null)
  model.select(taskId, tab.id)
}

function renameTab(model: AppModel): void {
  const { taskId, tabs, at } = current(model)
  const tab = tabs[at]
  if (!taskId || !tab) return
  dialog.set(
    <TextDialog
      title={t("menu.renameTab")}
      initial={tabLabel(tab)}
      submitLabel={t("dialog.save")}
      onSubmit={async (title) => {
        await model.client.request("tab.rename", { taskId, tabId: tab.id, title })
        await model.refreshTabsNow()
      }}
    />,
  )
}

const inTask = (model: AppModel): boolean => !!model.selection.get().taskId
const hasTabs = (model: AppModel): boolean => tabsOf(model).length > 0
const unsplit = (model: AppModel): boolean => {
  const { tabs, at } = current(model)
  return !!tabs[at] && !isSplit(tabs[at]?.split)
}

const COMMANDS: readonly WebCommand[] = [
  { id: "help.open", chords: ["f1"], prefix: false, run: openHelp },
  { id: "focus.next", chords: ["f4"], prefix: false, run: () => focusPane(1) },
  {
    id: "chat.tab.chooseEngine",
    chords: ["ctrl+e"],
    prefix: false,
    surface: "workspace",
    live: inTask,
    run: (model) => {
      const { taskId } = model.selection.get()
      if (taskId) dialog.set(<NewChatDialog model={model} taskId={taskId} />)
    },
  },
  { id: "chat.tab.rename", chords: ["f2"], prefix: false, surface: "workspace", live: unsplit, run: renameTab },
  {
    id: "chat.tab.cycle-next",
    chords: ["ctrl+]"],
    prefix: false,
    surface: "workspace",
    live: hasTabs,
    run: (model) => go(model, (current(model).at + 1) % tabsOf(model).length),
  },
  {
    id: "chat.tab.cycle-prev",
    chords: ["ctrl+["],
    prefix: false,
    surface: "workspace",
    live: hasTabs,
    run: (model) => go(model, (current(model).at - 1 + tabsOf(model).length) % tabsOf(model).length),
  },
  {
    id: "chat.tab.goto",
    chords: ["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => `ctrl+${digit}`),
    prefix: false,
    surface: "workspace",
    live: hasTabs,
    run: (model, chord = "ctrl+1") => go(model, Number(chord.slice("ctrl+".length)) - 1),
  },
]

registerCommands(() => COMMANDS)

export function useWorkspaceKeys(model: AppModel): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dialog.get() || typingInField(e.target) || e.metaKey || e.altKey) return
      const open = page.get()
      // A full-window page covers the sidebar and the workspace; the rail pages only the workspace.
      if (open === "worktrees") return
      if (e.key === "F7" && !e.ctrlKey && !e.shiftKey) {
        e.preventDefault()
        e.stopPropagation()
        jumpToNextAttention(model)
        return
      }
      const surface = currentSurface() ?? (inTask(model) ? "workspace" : "sidebar")
      const { taskId: taskNow } = model.selection.get()
      if (!open && taskNow && !e.ctrlKey && !e.shiftKey && e.key === "Enter" && !hasTabs(model) && !inRail(e.target)) {
        e.preventDefault()
        e.stopPropagation()
        dialog.set(<NewChatDialog model={model} taskId={taskNow} />)
        return
      }
      const chord = chordOf(e)
      const command = allCommands()
        .filter(
          (c) =>
            !c.prefix &&
            !c.native &&
            c.chords.includes(chord) &&
            appliesOn(c, surface) &&
            !(open && c.surface) &&
            c.live?.(model) !== false,
        )
        .sort((a, b) => specificity(a, surface) - specificity(b, surface))[0]
      if (!command) return
      e.preventDefault()
      e.stopPropagation()
      command.run(model, chord)
    }
    window.addEventListener("keydown", onKey, { capture: true })
    return () => window.removeEventListener("keydown", onKey, { capture: true })
  }, [model])
}

/** F7: open the next pending episode and clear it, as visiting it does in the TUI. */
export function jumpToNextAttention(model: AppModel): void {
  const payload = model.tasks.get()
  if (!payload) return
  const row = nextAttention(
    payload.attention,
    payload.tasks.map((task) => task.id),
    model.selection.get(),
  )
  if (!row) {
    toast(t("inbox.empty"))
    return
  }
  if (isRoutineState(row.state)) {
    openRoutineEpisode(model, row)
    return
  }
  if (row.taskId === null) return
  model.select(row.taskId, row.tabId)
  void model.client
    .request("attention.dismiss", { taskId: row.taskId, ...(row.tabId ? { tabId: row.tabId } : {}) })
    .catch((err) => toast(String(err), "error"))
}
