/**
 * The TUI's direct workspace chords (`keybindings-chat.ts`): Ctrl+1..9 jump to a tab,
 * Ctrl+] / Ctrl+[ cycle, Ctrl+E opens the new-conversation picker, F2 renames the tab.
 * Capture phase so xterm can't take them first; inactive while a dialog is open or a
 * text field has focus. A browser that reserves a chord (Ctrl+1..9 off macOS) never
 * delivers it, which is the browser's call, not the page's.
 */

import { useEffect } from "react"
import { TextDialog } from "./dialogs.tsx"
import { t } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { tabLabel } from "./rail-view.tsx"
import { NewChatDialog } from "./task-dialogs.tsx"
import { dialog, page, preview } from "./ui.ts"

function typingInField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  // xterm's own textarea is the terminal, not a field.
  if (target.closest(".xterm")) return false
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
}

export function useWorkspaceKeys(model: AppModel): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dialog.get() || page.get() || typingInField(e.target) || e.metaKey || e.altKey) return
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
