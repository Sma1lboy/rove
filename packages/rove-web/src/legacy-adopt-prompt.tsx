/**
 * Once per page after connect, like the TUI at launch: the sidebar still holds rows an older Rove added by itself.
 * "Ask an agent" starts a session in the project's own checkout with the list; it deletes only what the user confirms.
 */

import { useState } from "react"
import { DialogShell } from "./dialogs.tsx"
import type { AppModel } from "./model.ts"
import { requestErrorText } from "./request-error.ts"
import { tc } from "./tui-copy.ts"
import { closeDialog, dialog } from "./ui.ts"
import { Button } from "./ui/button.tsx"
import { DIALOG_BODY } from "./ui/overlay.ts"
import { ACTIONS } from "./ui/text.ts"

const DISMISSED_KEY = "rove.web.legacyAdopt.dismissed"
const LISTED = 6

interface Leftover {
  readonly id: string
  readonly title: string
  readonly repo: string
  readonly worktreePath: string
}

let asked = false

const repoName = (repo: string): string =>
  repo
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .at(-1) ?? repo

function dismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1"
  } catch {
    return false
  }
}

function dismiss(): void {
  try {
    localStorage.setItem(DISMISSED_KEY, "1")
  } catch {}
}

/** The dialog's short list: `repo/name`, capped. */
function summary(tasks: readonly Leftover[]): string {
  const lines = tasks.slice(0, LISTED).map((task) => `  ${repoName(task.repo)}/${task.title}`)
  if (tasks.length > LISTED) lines.push(`  ${tc("tasks", "confirm.legacyAdoptMore", { count: tasks.length - LISTED })}`)
  return lines.join("\n")
}

/** What the agent is told: every row, with the id and path it needs. */
function prompt(tasks: readonly Leftover[]): string {
  const list = tasks.map((task) => `- ${task.id} · ${task.title} · ${task.worktreePath}`).join("\n")
  return tc("tasks", "confirm.legacyAdoptPrompt", { list })
}

/** Call once a connection says hello. Another open dialog (the update prompt) wins; this page does not ask again. */
export async function maybeAskLegacyAdopt(model: AppModel): Promise<void> {
  if (asked || dismissed()) return
  asked = true
  const { tasks } = await model.client
    .request<{ tasks: readonly Leftover[] }>("worktree.legacyAdopted", {})
    .catch(() => ({ tasks: [] as Leftover[] }))
  if (tasks.length === 0 || dialog.get() !== null) return
  dialog.set(<LegacyAdoptPrompt model={model} tasks={tasks} />)
}

function LegacyAdoptPrompt(props: { model: AppModel; tasks: readonly Leftover[] }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const clean = async () => {
    setBusy(true)
    setError(null)
    try {
      const { taskId } = await props.model.client.request<{ taskId: string }>("worktree.legacyCleanup", {
        title: tc("tasks", "confirm.legacyAdoptSessionTitle"),
        prompt: prompt(props.tasks),
      })
      closeDialog()
      props.model.selectWhenListed(taskId)
    } catch (err) {
      setError(tc("tasks", "confirm.legacyAdoptFailed", { message: requestErrorText(err) }))
    } finally {
      setBusy(false)
    }
  }
  return (
    <DialogShell title={tc("tasks", "confirm.legacyAdoptTitle", { count: props.tasks.length })}>
      <div className={DIALOG_BODY}>
        <p className="text-muted whitespace-pre-wrap">
          {tc("tasks", "confirm.legacyAdoptBody", { list: summary(props.tasks) })}
        </p>
        {error && <p className="text-error">{error}</p>}
        <div className={ACTIONS}>
          <Button
            onClick={() => {
              dismiss()
              closeDialog()
            }}
          >
            {tc("tasks", "confirm.legacyAdoptNever")}
          </Button>
          <Button onClick={closeDialog}>{tc("tasks", "confirm.legacyAdoptLater")}</Button>
          <Button variant="filled" disabled={busy} autoFocus onClick={() => void clean()}>
            {tc("tasks", "confirm.legacyAdoptClean")}
          </Button>
        </div>
      </div>
    </DialogShell>
  )
}
