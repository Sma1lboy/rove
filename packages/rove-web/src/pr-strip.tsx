/** One quiet line of PR actions in the Files pane: only what the task's PR needs now. */

import type { TaskRow } from "rove-bridge/protocol"
import { t } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { type PrAction, type PrPromptKind, prActions } from "./pr-strip.ts"
import { archiveFlow } from "./task-flows.tsx"
import { streamKey } from "./term-mount.ts"
import { toast } from "./ui.ts"
import { Button } from "./ui/button.tsx"

const BRACKETED_PASTE = { start: "\x1b[200~", end: "\x1b[201~" } as const

/** The engine tab a prompt lands in: the selected one when it is an engine, else the task's first. */
function engineTab(model: AppModel, taskId: string): string | undefined {
  const picked = model.engineTarget(taskId).tabId
  return picked ?? model.tabs.get()[taskId]?.find((row) => row.kind === "engine")?.id
}

/**
 * Types the prompt into the task's engine input as a paste, so the user can edit it and press Enter.
 * The prompt is built bridge-side (`task.prompt`), the way the send flows build theirs.
 */
async function prefill(model: AppModel, task: TaskRow, kind: PrPromptKind): Promise<void> {
  const tab = engineTab(model, task.id)
  if (!tab) {
    toast(t("files.stripNoEngine"), "error")
    return
  }
  try {
    const res = await model.client.request<{
      outcome: "ok" | "none" | "unavailable"
      prompt?: string
      detail?: string
    }>("task.prompt", { taskId: task.id, kind })
    if (res.outcome === "unavailable") toast(t("files.stripUnavailable", { detail: res.detail ?? "" }), "error")
    else if (res.outcome === "none" || !res.prompt) toast(t("files.stripNothing"), "error")
    else {
      if (model.selection.get().tabId !== tab) model.select(task.id, tab)
      const data = `${BRACKETED_PASTE.start}${res.prompt}${BRACKETED_PASTE.end}`
      await model.client.request("term.input", { stream: streamKey(task.id, tab), data })
      toast(t("files.stripFilled"))
    }
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err), "error")
  }
}

const LABEL: Record<PrAction, string> = {
  commit: "files.stripCommit",
  createPR: "files.stripCreate",
  conflicts: "files.stripConflicts",
  fixCI: "files.stripFixCi",
  comments: "files.stripComments",
  archive: "files.stripArchive",
}

export function PrStrip({ model, task }: { model: AppModel; task: TaskRow }) {
  const actions = prActions(task)
  if (actions.length === 0) return null
  return (
    <div className="flex flex-wrap justify-end gap-x-3.5 gap-y-1 px-2 pb-2 font-mono text-meta whitespace-nowrap">
      {actions.map((action) => (
        <Button
          key={action}
          onClick={() => (action === "archive" ? void archiveFlow(model, task) : void prefill(model, task, action))}
        >
          {t(LABEL[action])}
        </Button>
      ))}
    </div>
  )
}
