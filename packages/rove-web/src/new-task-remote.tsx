/**
 * New Task on another registered machine (`task.spawn` with `machine`): the repo is a path on that
 * machine, so this form skips the local disk reads (`fs.subdirs`, `repo.probe`) the Existing tab does.
 */

import { useState } from "react"
import { DialogActions } from "./dialogs.tsx"
import { t } from "./i18n/index.ts"
import type { TabProps } from "./new-task-dialog.tsx"
import { filterText, splitRepoRow } from "./new-task-paths.ts"
import { useStore } from "./store.ts"
import { SuggestField, focusField } from "./suggest-field.tsx"
import { tc } from "./tui-copy.ts"

/**
 * A task on another registered machine: its repo is a path THERE (suggested from the projects it
 * already has), and `task.spawn` runs `add` in that machine's daemon. Clone and adopt read this
 * machine's disk, so they stay local.
 */
export function RemoteTab(props: TabProps & { machine: string; host: string; initialRepo?: string }) {
  const { model } = props
  const remote = useStore(model.remote)
  const known = [
    ...new Set(remote.filter((task) => task.machine?.id === props.machine).map((task) => task.repo)),
  ].sort()
  const [repo, setRepo] = useState(props.initialRepo ?? known[0] ?? "")
  const [open, setOpen] = useState(true)
  const [baseRef, setBaseRef] = useState("")
  const rows = filterText(known, repo)
  const create = () =>
    props.run(async () => {
      const path = repo.trim()
      if (!path) {
        focusField("repo")
        throw new Error(t("newTask.needRepo"))
      }
      const res = await model.client.request<{ taskIds: string[] }>("task.spawn", {
        repo: path,
        machine: props.machine,
        ...(props.engine ? { engine: props.engine } : {}),
        ...(baseRef.trim() ? { baseBranch: baseRef.trim() } : {}),
      })
      const created = res.taskIds[0]
      if (created) model.selectWhenListed(created)
    })
  return (
    <form
      className="dialog-body"
      onSubmit={(e) => {
        e.preventDefault()
        void create()
      }}
    >
      <div className="field">
        <span className="kicker">{tc("newTask", "field.repo")}</span>
        <SuggestField
          field="repo"
          value={repo}
          placeholder={t("newTask.remoteRepoPlaceholder", { host: props.host })}
          onChange={(value) => {
            setRepo(value)
            setOpen(true)
          }}
          items={rows.map((path) => {
            const { base, dir } = splitRepoRow(path)
            return { key: path, text: base, dim: dir, accent: path === repo.trim() }
          })}
          open={open}
          onPick={(index) => {
            const path = rows[index]
            if (path === undefined) return
            setRepo(path)
            setOpen(false)
            focusField("branch")
          }}
          onEnter={() => focusField("branch")}
        />
        <span className="muted">{t("newTask.remoteRepoHint", { host: props.host })}</span>
      </div>
      <div className="field">
        <span className="kicker">{t("newTask.baseBranch")}</span>
        <SuggestField
          field="branch"
          value={baseRef}
          placeholder="main"
          onChange={setBaseRef}
          items={[]}
          open={false}
          onPick={() => {}}
          onEnter={() => void create()}
        />
      </div>
      {props.error && <p className="error">※ {props.error}</p>}
      <DialogActions busy={props.busy} submitLabel={tc("newTask", "button.create")} />
    </form>
  )
}
