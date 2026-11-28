/**
 * An archived session, read only: its conversation from the engine's history and an Unarchive button. Archiving
 * stopped its processes, so nothing here attaches a terminal or starts one; Unarchive brings the normal view back.
 */

import type { TaskRow } from "rove-bridge/protocol"
import { t } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { archiveFlow } from "./task-flows.tsx"
import { TranscriptView } from "./transcript-view.tsx"
import { tc } from "./tui-copy.ts"
import { Button } from "./ui/button.tsx"
import { CHAT_BAR } from "./ui/transcript.ts"

export function ArchivedPane({ model, task }: { model: AppModel; task: TaskRow }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col pt-2">
      <div className={CHAT_BAR}>
        <span className="text-warning">{t("workspace.archived")}</span>
        <span className="min-w-0 flex-1 truncate text-subtle">{t("workspace.archivedNote")}</span>
        <Button variant="filled" onClick={() => void archiveFlow(model, task)}>
          {tc("tasks", "menu.unarchive")}
        </Button>
      </div>
      <TranscriptView model={model} task={task} active />
    </div>
  )
}
