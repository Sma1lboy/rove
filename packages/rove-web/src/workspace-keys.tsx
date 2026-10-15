/**
 * The TUI's direct workspace chords (`keybindings-chat.ts`): Ctrl+1..9 jump to a tab,
 * Ctrl+] / Ctrl+[ cycle, Ctrl+E opens the new-conversation picker, F2 renames the tab, and
 * (global) F7 jumps to the next Inbox episode.
 * Capture phase so xterm can't take them first; inactive while a dialog is open or a
 * text field has focus. A browser that reserves a chord (Ctrl+1..9 off macOS) never
 * delivers it, which is the browser's call, not the page's.
 */

import { useEffect } from "react"
import { TextDialog } from "./dialogs.tsx"
import { t } from "./i18n/index.ts"
import { nextAttention } from "./inbox.ts"
import type { AppModel } from "./model.ts"
import { NewChatDialog } from "./new-chat-dialog.tsx"
import { tabLabel } from "./rail-view.tsx"
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

export function useWorkspaceKeys(model: AppModel): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dialog.get() || page.get() || typingInField(e.target) || e.metaKey || e.altKey) return
      if (e.key === "F7" && !e.ctrlKey && !e.shiftKey) {
        e.preventDefault()
        e.stopPropagation()
        jumpToNextAttention(model)
        return
      }
      const { taskId, tabId } = model.selection.get()
      if (!taskId) return
      const tabs = model.tabs.get()[taskId] ?? []
      const at = tabs.findIndex((tab) => tab.id === tabId)
      const go = (i: number) => {
        const tab = tabs[i]
        if (!tab) return
        preview.set(null)
        model.select(taskId, tab.id)
      }
      if (e.ctrlKey && !e.shiftKey && /^[1-9]$/.test(e.key)) go(Number(e.key) - 1)
      else if (e.ctrlKey && e.key === "]" && tabs.length > 0) go((at + 1) % tabs.length)
      else if (e.ctrlKey && e.key === "[" && tabs.length > 0) go((at - 1 + tabs.length) % tabs.length)
      else if (!e.ctrlKey && !e.shiftKey && e.key === "Enter" && tabs.length === 0 && !inRail(e.target))
        dialog.set(<NewChatDialog model={model} taskId={taskId} />)
      else if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "e")
        dialog.set(<NewChatDialog model={model} taskId={taskId} />)
      else if (!e.ctrlKey && e.key === "F2" && tabs[at]) {
        const tab = tabs[at]
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
      } else return
      e.preventDefault()
      e.stopPropagation()
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
  if (row.taskId === null) return
  model.select(row.taskId, row.tabId)
  void model.client
    .request("attention.dismiss", { taskId: row.taskId, ...(row.tabId ? { tabId: row.tabId } : {}) })
    .catch((err) => toast(String(err), "error"))
}
