/**
 * The Machines overview (palette: Machines; the `[ machines ]` link where a remote task's files are
 * out of reach): one section per registered machine with its state, version and why it is not online,
 * its tasks by the rail's states, its repos, and a way to start a task there. Only what the bridge
 * already knows (`machines.list`, the task feed, `machines.repos`): nothing about load or disk.
 */

import { en as tasksEn, zh as tasksZh } from "@sma1lboy/rove/src/tui/i18n/messages/tasks.ts"
import { useEffect, useState } from "react"
import type { TaskRow } from "rove-bridge/protocol"
import { DialogShell } from "./dialogs.tsx"
import { t, useLocale } from "./i18n/index.ts"
import { enterWorkspace } from "./layout.ts"
import { groupByState, reasonKey, tasksOfMachine } from "./machines-overview.ts"
import { type MachineRow, machineLabel, useMachines } from "./machines-view.tsx"
import type { AppModel } from "./model.ts"
import type { RemoteRepo } from "./new-session-remote.ts"
import { startNewTask } from "./new-session-view.tsx"
import { requestRemembered } from "./remembered.ts"
import { useStore } from "./store.ts"
import { closeDialog, dialog } from "./ui.ts"
import { Button } from "./ui/button.tsx"
import {
  MC,
  MC_ACTIONS,
  MC_GROUP,
  MC_HEAD,
  MC_ITEM,
  MC_ITEM_META,
  MC_ITEM_TITLE,
  MC_NAME,
  MC_NOTE,
  MC_SECTION,
} from "./ui/machines.ts"
import { DIALOG_BODY } from "./ui/overlay.ts"
import { TONE } from "./ui/tone.ts"

export function openMachines(model: AppModel): void {
  dialog.set(<MachinesDialog model={model} />)
}

interface ReposReply {
  readonly repos: readonly RemoteRepo[]
  readonly reason?: string
  readonly message?: string
}

function TaskList({ model, tasks }: { model: AppModel; tasks: readonly TaskRow[] }) {
  const open = (task: TaskRow) => {
    closeDialog()
    model.select(task.id)
    enterWorkspace()
  }
  return groupByState(tasks).map((group) => (
    <div key={group.state}>
      <p className={`${MC_GROUP} m-0`}>{t(`rail.state.${group.state}`)}</p>
      {group.tasks.map((task) => (
        <Button
          key={task.id}
          variant="row"
          className={`${MC_ITEM} w-full rounded-sm py-0.5 hover:bg-hover`}
          onClick={() => open(task)}
        >
          <span className={MC_ITEM_TITLE}>{task.label}</span>
          <span className={MC_ITEM_META}>{task.branch}</span>
        </Button>
      ))}
    </div>
  ))
}

function RepoList({ model, alias }: { model: AppModel; alias: string }) {
  const [reply, setReply] = useState<ReposReply | { readonly failed: string } | null>(null)
  useEffect(() => {
    let live = true
    requestRemembered<ReposReply>(model, "machines.repos", { machine: alias }).then(
      (next) => live && setReply(next),
      (err: unknown) => live && setReply({ failed: err instanceof Error ? err.message : String(err) }),
    )
    return () => {
      live = false
    }
  }, [model, alias])
  if (!reply) return <p className={MC_NOTE}>{t("machines.loading")}</p>
  if ("failed" in reply) return <p className={MC_NOTE}>{t("machines.reposFailed", { message: reply.failed })}</p>
  if (reply.reason) {
    return <p className={MC_NOTE}>{t("machines.reposFailed", { message: reply.message ?? reply.reason })}</p>
  }
  if (reply.repos.length === 0) return <p className={MC_NOTE}>{t("machines.noRepos")}</p>
  return reply.repos.map((repo) => (
    <div key={repo.id} className={MC_ITEM}>
      <span className={MC_ITEM_TITLE}>{repo.id}</span>
      <span className={MC_ITEM_META} title={repo.primary ?? repo.checkouts[0]}>
        {repo.primary ?? repo.checkouts[0] ?? ""}
      </span>
    </div>
  ))
}

type UpdateReply =
  | { ok: true; result: { from: string | null; to: string | null; changed: boolean } }
  | { ok: false; message: string }

function Machine(props: {
  model: AppModel
  row: MachineRow
  tasks: readonly TaskRow[]
  words: (typeof tasksEn)["machine"]
}) {
  const { model, row, tasks, words } = props
  const [shown, setShown] = useState<"tasks" | "repos" | null>(null)
  const online = row.state === "online"
  const key = reasonKey(row.reason)
  const counts = groupByState(tasks).map((group) => `${group.tasks.length} ${t(`rail.state.${group.state}`)}`)
  const toggle = (view: "tasks" | "repos") => setShown(shown === view ? null : view)
  const [update, setUpdate] = useState<{ busy: boolean; note?: string }>({ busy: false })
  const runUpdate = () => {
    setUpdate({ busy: true })
    model.client.request<UpdateReply>("machines.update", { machine: row.alias }).then(
      (out) =>
        setUpdate({
          busy: false,
          note: !out.ok
            ? t("machines.updateFailed", { message: out.message })
            : t(out.result.changed ? "machines.updated" : "machines.upToDate", {
                from: out.result.from ?? "?",
                to: out.result.to ?? "?",
              }),
        }),
      (err: unknown) =>
        setUpdate({
          busy: false,
          note: t("machines.updateFailed", { message: err instanceof Error ? err.message : String(err) }),
        }),
    )
  }
  return (
    <section className={MC_SECTION}>
      <div className={MC_HEAD}>
        <span className={`${MC_NAME} ${online ? "" : TONE.warning}`}>{machineLabel(row, words)}</span>
        <span className="text-muted">{counts.length > 0 ? counts.join(" · ") : t("machines.noTasks")}</span>
      </div>
      {key && <p className={MC_NOTE}>{t(key)}</p>}
      {(update.busy || update.note) && <p className={MC_NOTE}>{update.busy ? t("machines.updating") : update.note}</p>}
      <div className={MC_ACTIONS}>
        {row.behind && (
          <Button hit="tight" disabled={update.busy} onClick={runUpdate}>
            {t("machines.update")}
          </Button>
        )}
        {online && (
          <Button
            hit="tight"
            onClick={() => {
              closeDialog()
              startNewTask(undefined, row.alias)
            }}
          >
            {t("machines.newHere")}
          </Button>
        )}
        {tasks.length > 0 && (
          <Button hit="tight" aria-expanded={shown === "tasks"} onClick={() => toggle("tasks")}>
            {shown === "tasks" ? t("machines.hide") : t("machines.tasks")}
          </Button>
        )}
        {online && (
          <Button hit="tight" aria-expanded={shown === "repos"} onClick={() => toggle("repos")}>
            {shown === "repos" ? t("machines.hide") : t("machines.repos")}
          </Button>
        )}
      </div>
      {shown === "tasks" && <TaskList model={model} tasks={tasks} />}
      {shown === "repos" && <RepoList model={model} alias={row.alias} />}
    </section>
  )
}

export function MachinesDialog({ model }: { model: AppModel }) {
  const locale = useLocale()
  const machines = useMachines(model)
  const remote = useStore(model.remote)
  const words = (locale === "zh" ? tasksZh : tasksEn).machine
  return (
    <DialogShell title={t("machines.title")} wide>
      <div className={`${DIALOG_BODY} ${MC}`}>
        {machines.length === 0 && <p className={MC_NOTE}>{t("machines.none")}</p>}
        {machines.map((row) => (
          <Machine key={row.alias} model={model} row={row} tasks={tasksOfMachine(remote, row.alias)} words={words} />
        ))}
      </div>
    </DialogShell>
  )
}
