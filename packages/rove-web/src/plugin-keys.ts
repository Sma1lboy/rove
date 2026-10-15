/**
 * The user's plugin chords (`plugins:` in `keybindings.yaml`, TUI `use-plugin-keybindings.ts`):
 * a `pane:` chord opens the plugin pane in the open task, an `action:` chord runs the action the
 * Mac's file binds to it. Host-level like the TUI's (registered last in its stack, so a plugin
 * chord beats a built-in one it shadows): inert while a dialog or a full-window page is open, or a
 * field has focus. The page names a pane or a chord; what runs is the Mac's.
 */

import { useEffect } from "react"
import { chordCandidates } from "./chord.ts"
import { errorText } from "./dialogs.tsx"
import { t } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { dialog, page, toast } from "./ui.ts"
import { type PluginChord, userKeys } from "./user-keys.ts"
import { typingInField } from "./workspace-keys.tsx"

async function fire(model: AppModel, binding: PluginChord): Promise<void> {
  try {
    if (binding.kind === "action") {
      await model.client.request("plugin.chordAction", { chord: binding.chord })
      return
    }
    const { taskId, tabId } = model.selection.get()
    if (!taskId) {
      toast(t("keys.pluginNoTask"), "error")
      return
    }
    const opened = await model.client.request<{ tabId: string }>("plugin.paneOpen", {
      taskId,
      pane: binding.target,
      ...(tabId ? { tabId } : {}),
    })
    await model.refreshTabsNow()
    model.select(taskId, opened.tabId)
  } catch (err) {
    toast(errorText(err), "error")
  }
}

export function usePluginChords(model: AppModel): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const bound = userKeys.get().plugins
      const full = page.get() === "worktrees" || page.get() === "update"
      if (bound.length === 0 || full || dialog.get() || typingInField(e.target)) return
      const candidates = chordCandidates(e)
      const hit = bound.find((binding) => candidates.includes(binding.chord))
      if (!hit) return
      e.preventDefault()
      e.stopImmediatePropagation()
      void fire(model, hit)
    }
    window.addEventListener("keydown", onKey, { capture: true })
    return () => window.removeEventListener("keydown", onKey, { capture: true })
  }, [model])
}
