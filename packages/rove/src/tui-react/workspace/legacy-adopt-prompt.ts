/**
 * One modal at launch when the sidebar still holds rows an older Rove added by
 * itself. "Ask an agent" starts a session in the project's own checkout with
 * the list; the agent deletes only what the user confirms there.
 */

import { userFacingErrorMessage } from "@/lib/error-message"
import { RoveDaemonClient } from "@sma1lboy/rove-daemon/client"
import { defaultDaemonSocketPath } from "@sma1lboy/rove-daemon/daemon/paths"
import type { ApiEnvelope } from "@sma1lboy/rove-daemon/daemon/protocol"
import { useEffect, useRef } from "react"
import type { Task } from "../../types/task"
import type { KVContext } from "../context/kv"
import { useOptionalNotifications } from "../context/notifications"
import { t } from "../i18n"
import type { DialogContext } from "../ui/dialog"
import { DialogChoice } from "../ui/dialog-choice"

export const LEGACY_ADOPT_DISMISSED_KEY = "notice.legacyAdoptDismissed"
const LISTED = 6

export interface LegacyAdoptOrchestrator {
  legacyAdoptedTasks(): Promise<readonly Task[]>
  ensureMainTask(repo: string): Promise<Task>
}

function repoName(repo: string): string {
  return (
    repo
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .at(-1) ?? repo
  )
}

/** The dialog's short list: `repo/name`, capped. */
export function legacyAdoptSummary(tasks: readonly Task[]): string {
  const lines = tasks.slice(0, LISTED).map((task) => `  ${repoName(task.repo)}/${task.title}`)
  if (tasks.length > LISTED) lines.push(`  ${t("tasks.confirm.legacyAdoptMore", { count: tasks.length - LISTED })}`)
  return lines.join("\n")
}

/** What the agent is told: every row, with the id and path it needs. */
export function legacyAdoptPrompt(tasks: readonly Task[]): string {
  const list = tasks.map((task) => `- ${task.id} · ${task.title} · ${task.worktreePath}`).join("\n")
  return t("tasks.confirm.legacyAdoptPrompt", { list })
}

async function startCleanupSession(orch: LegacyAdoptOrchestrator, tasks: readonly Task[]): Promise<string> {
  const first = tasks[0]
  if (!first) throw new Error("nothing to clean up")
  // A repo with no project row of its own (never opened as a project) still gets the session, in its own worktree.
  const main = await orch.ensureMainTask(first.repo).catch(() => null)
  const client = new RoveDaemonClient(defaultDaemonSocketPath())
  try {
    const envelope = await client.request<ApiEnvelope<{ task: { id: string } }>>("api.invoke", {
      verb: "add",
      params: {
        // `add` refuses --repo next to --no-worktree: the parent decides the directory.
        ...(main ? { parent: main.id, "no-worktree": true } : { repo: first.repo }),
        title: t("tasks.confirm.legacyAdoptSessionTitle"),
        prompt: legacyAdoptPrompt(tasks),
      },
    })
    if (!envelope.ok) throw new Error(`${envelope.error.code}: ${envelope.error.message}`)
    return envelope.result.task.id
  } finally {
    client.close()
  }
}

export function useLegacyAdoptPrompt(
  orch: LegacyAdoptOrchestrator,
  deps: {
    dialog: DialogContext
    kv: KVContext
    /** Another launch modal owns the dialog stack this time. */
    blocked: boolean
    enterTask: (taskId: string) => Promise<void> | void
  },
): void {
  const notif = useOptionalNotifications()
  const notifRef = useRef(notif)
  notifRef.current = notif
  const asked = useRef(false)
  const depsRef = useRef(deps)
  depsRef.current = deps
  useEffect(() => {
    if (asked.current || deps.blocked) return
    asked.current = true
    if (deps.kv.get(LEGACY_ADOPT_DISMISSED_KEY, false)) return
    void (async () => {
      // An old daemon has no such request; the modal is simply not owed.
      const tasks = await Promise.resolve()
        .then(() => orch.legacyAdoptedTasks())
        .catch(() => [])
      if (tasks.length === 0) return
      const pick = await DialogChoice.show<"clean" | "never">(depsRef.current.dialog, {
        title: t("tasks.confirm.legacyAdoptTitle", { count: tasks.length }),
        message: t("tasks.confirm.legacyAdoptBody", { list: legacyAdoptSummary(tasks) }),
        options: [
          { value: "clean", label: t("tasks.confirm.legacyAdoptClean") },
          { value: undefined, label: t("tasks.confirm.legacyAdoptLater") },
          { value: "never", label: t("tasks.confirm.legacyAdoptNever") },
        ],
      })
      if (pick === "never") depsRef.current.kv.set(LEGACY_ADOPT_DISMISSED_KEY, true)
      if (pick !== "clean") return
      try {
        await depsRef.current.enterTask(await startCleanupSession(orch, tasks))
      } catch (err) {
        const title = t("tasks.confirm.legacyAdoptFailed", { message: userFacingErrorMessage(err) })
        notifRef.current?.notify({ kind: "error", taskId: "", tabId: "", title })
      }
    })()
  }, [orch, deps.blocked, deps.kv])
}
