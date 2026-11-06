/** Puts text in a task's engine input without sending it, so the person can edit it and press Enter. */

import { t } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { streamKey } from "./term-mount.ts"
import { toast } from "./ui.ts"

/** A bracketed paste: the engine's composer takes newlines as text, and Enter stays the person's. */
const BRACKETED_PASTE = { start: "\x1b[200~", end: "\x1b[201~" } as const

/** The engine tab a prompt lands in: the selected one when it is an engine, else the task's first. */
function engineTab(model: AppModel, taskId: string): string | undefined {
  const picked = model.engineTarget(taskId).tabId
  return picked ?? model.tabs.get()[taskId]?.find((row) => row.kind === "engine")?.id
}

/** True once the text is in the input; a task with no engine tab toasts and returns false. */
export async function prefillEngine(model: AppModel, taskId: string, text: string): Promise<boolean> {
  const tab = engineTab(model, taskId)
  if (!tab) {
    toast(t("files.stripNoEngine"), "error")
    return false
  }
  try {
    if (model.selection.get().tabId !== tab) model.select(taskId, tab)
    await model.client.request("term.input", {
      stream: streamKey(taskId, tab),
      data: `${BRACKETED_PASTE.start}${text}${BRACKETED_PASTE.end}`,
    })
    toast(t("files.stripFilled"))
    return true
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err), "error")
    return false
  }
}
