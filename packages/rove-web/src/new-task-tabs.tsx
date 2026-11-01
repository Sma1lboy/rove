/** The new-task dialog's "For New Repo" and "Adopt Worktree" modes (TUI `tab-clone.tsx`, `tab-adopt.tsx`). */

import { useEffect, useState } from "react"
import { BridgeRequestError } from "./bridge.ts"
import { DialogActions } from "./dialogs.tsx"
import { deviceHint } from "./key-hints.ts"
import { Legend } from "./ui/legend.tsx"
import type { AppModel } from "./model.ts"
import type { AdoptableRow, ProbeResult, RepoField } from "./new-task-dialog.tsx"
import { CLONE_PARENT_KEY, deriveFolderName, expandTilde, filterByGlob, joinPicked } from "./new-task-paths.ts"
import { SuggestField, focusField } from "./suggest-field.tsx"
import { tc } from "./tui-copy.ts"
import { toast } from "./ui.ts"

interface TabProps {
  readonly model: AppModel
  readonly engine: string
  readonly busy: boolean
  readonly error: string | null
  readonly run: (action: () => Promise<void>) => Promise<void>
}

export function CloneTab({ model, engine, busy, error, run }: TabProps) {
  const [url, setUrl] = useState("")
  const [parent, setParent] = useState(() => localStorage.getItem(CLONE_PARENT_KEY) || "~/")
  const [folder, setFolder] = useState<string | null>(null)
  const [baseRef, setBaseRef] = useState("main")
  const [progress, setProgress] = useState("")
  const [parentOpen, setParentOpen] = useState(false)
  const [dirs, setDirs] = useState<{ base: string; home: string; names: readonly string[] }>({
    base: "",
    home: "",
    names: [],
  })

  useEffect(() => {
    let stale = false
    const timer = setTimeout(() => {
      void model.client
        .request<{ base: string; home: string; names: string[] }>("fs.subdirs", { path: parent })
        .then((res) => !stale && setDirs(res))
        .catch(() => {})
    }, 60)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [model, parent])

  const folderName = folder ?? deriveFolderName(url)
  const parentDir = expandTilde(parent.trim(), dirs.home)

  const create = () =>
    run(async () => {
      if (!url.trim()) {
        focusField("url")
        throw new Error(tc("newTask", "error.gitUrlRequired"))
      }
      let cloned: { path: string }
      try {
        setProgress("")
        cloned = await model.client.request<{ path: string }>(
          "repo.clone",
          {
            url: url.trim(),
            parentDir,
            ...(folder?.trim() ? { folder: folder.trim() } : {}),
          },
          setProgress,
        )
      } catch (err) {
        if (err instanceof BridgeRequestError && err.code === "CLONE_FAILED") {
          throw new Error(tc("newTask", "error.cloneFailed", { error: err.message }))
        }
        throw err
      }
      localStorage.setItem(CLONE_PARENT_KEY, parent.trim())
      const res = await model.client.request<{ taskIds: string[] }>("task.spawn", {
        repo: cloned.path,
        ...(engine ? { engine } : {}),
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
        <span className="kicker">{tc("newTask", "field.gitUrl")}</span>
        <input
          className="input"
          data-field="url"
          spellCheck={false}
          placeholder="https://github.com/user/repo.git"
          value={url}
          onChange={(e) => setUrl(e.target.value.replace(/[\r\n]+/g, ""))}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.ctrlKey || e.metaKey) return
            e.preventDefault()
            if (url.trim()) focusField("parent")
          }}
        />
      </div>
      <div className="field">
        <span className="kicker">{tc("newTask", "field.parentDir")}</span>
        <SuggestField
          field="parent"
          value={parent}
          placeholder="~/"
          onChange={(value) => {
            setParentOpen(true)
            setParent(value)
          }}
          items={dirs.names.map((name) => ({ key: name, text: `${name}/` }))}
          open={parentOpen}
          onPick={(index) => {
            const name = dirs.names[index]
            if (name !== undefined) setParent(joinPicked(parent, dirs.base, name, dirs.home))
            setParentOpen(false)
            focusField("folder")
          }}
          onComplete={(index) => {
            const name = dirs.names[index]
            if (name === undefined) return false
            const next = `${joinPicked(parent, dirs.base, name, dirs.home)}/`
            if (next === parent) return false
            setParent(next)
            return true
          }}
          onEnter={() => focusField("folder")}
        />
        <span className="muted">{tc("newTask", "hint.remembered")}</span>
      </div>
      <div className="field">
        <span className="kicker">{tc("newTask", "field.folderName")}</span>
        <input
          className="input"
          data-field="folder"
          spellCheck={false}
          placeholder={tc("newTask", "placeholder.folderName")}
          value={folderName}
          onChange={(e) => setFolder(e.target.value.replace(/[\r\n]+/g, ""))}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.ctrlKey || e.metaKey) return
            e.preventDefault()
            focusField("clone-base")
          }}
        />
      </div>
      <div className="field">
        <span className="kicker">{tc("newTask", "field.baseBranch")}</span>
        <input
          className="input"
          data-field="clone-base"
          spellCheck={false}
          placeholder="main"
          value={baseRef}
          onChange={(e) => setBaseRef(e.target.value.replace(/[\r\n]+/g, ""))}
        />
      </div>
      {busy && (
        <p className="muted" data-field="clone-progress">
          {progress || tc("newTask", "clone.progressInto", { target: `${parentDir}/${folderName}` })}
        </p>
      )}
      {error && <p className="error">※ {error}</p>}
      <DialogActions busy={busy} submitLabel={tc("newTask", busy ? "button.cloning" : "button.create")} />
    </form>
  )
}

export function AdoptTab({
  model,
  engine,
  busy,
  error,
  run,
  repo,
  active,
}: TabProps & { repo: RepoField; active: boolean }) {
  const [filter, setFilter] = useState("")
  const [list, setList] = useState<readonly AdoptableRow[] | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [cursor, setCursor] = useState(0)
  const repoPath = repo.expanded

  useEffect(() => {
    if (!active || !repoPath) return
    let stale = false
    setList(null)
    setSelected(new Set())
    void model.client
      .request<ProbeResult>("repo.probe", { path: repoPath, adoptable: true })
      .then((res) => !stale && setList(res.worktrees ?? []))
      .catch(() => !stale && setList([]))
    return () => {
      stale = true
    }
  }, [model, active, repoPath])

  const shown = filterByGlob(list ?? [], filter)
  const toggle = (path: string) =>
    setSelected((now) => {
      const next = new Set(now)
      if (!next.delete(path)) next.add(path)
      return next
    })

  const adopt = () =>
    run(async () => {
      const chosen = selected.size > 0 ? shown.filter((w) => selected.has(w.path)) : shown.slice(cursor, cursor + 1)
      if (chosen.length === 0) throw new Error(tc("newTask", "error.noAdoptable"))
      let done = 0
      let first: string | undefined
      let last: string | undefined
      for (const w of chosen) {
        const args = { repo: repoPath, worktreePath: w.path, branch: w.branch, ...(engine ? { engine } : {}) }
        try {
          let res: { taskId: string }
          try {
            res = await model.client.request<{ taskId: string }>("worktree.adopt", args)
          } catch (err) {
            // A repo the bridge has never seen becomes a project first, as the TUI's auto-save does.
            if (!(err instanceof BridgeRequestError && err.code === "UNKNOWN_REPO")) throw err
            await model.client.request("task.openMain", { repo: repoPath })
            res = await model.client.request<{ taskId: string }>("worktree.adopt", args)
          }
          last = res.taskId
          done++
        } catch (err) {
          first ??= err instanceof Error ? err.message : String(err)
        }
      }
      if (done === 0) throw new Error(tc("newTask", "adopt.summaryNone", { error: first ?? "" }))
      toast(
        done < chosen.length
          ? tc("newTask", "adopt.summaryPartial", { done, total: chosen.length })
          : tc("newTask", "adopt.summaryAll", { count: done }),
      )
      if (last) model.selectWhenListed(last)
    })

  const hint =
    selected.size > 0
      ? tc("newTask", "adopt.hintSelected", { count: selected.size })
      : tc("newTask", "adopt.hintDefault")
  return (
    <form
      className="dialog-body"
      onSubmit={(e) => {
        e.preventDefault()
        void adopt()
      }}
      onKeyDown={(e) => {
        // Select-all exists only here; elsewhere ctrl+a stays the field's line-home.
        if (!(e.ctrlKey && !e.shiftKey && !e.metaKey && e.key.toLowerCase() === "a")) return
        e.preventDefault()
        e.stopPropagation()
        setSelected((now) => (shown.every((w) => now.has(w.path)) ? new Set() : new Set(shown.map((w) => w.path))))
      }}
    >
      <div className="field">
        <span className="kicker">{tc("newTask", "field.adoptFilter")}</span>
        <SuggestField
          field="filter"
          value={filter}
          placeholder={tc("newTask", "placeholder.adoptFilter")}
          onChange={setFilter}
          items={shown.map((w) => {
            const tags = [
              w.dirty === true ? "dirty" : w.dirty === null ? "dirty?" : "",
              w.roveManaged ? "" : "external",
            ]
              .filter(Boolean)
              .join(",")
            return {
              key: w.path,
              text: `${selected.has(w.path) ? "[x]" : "[ ]"} ${w.branch}${tags ? `  (${tags})` : ""}`,
              dim: w.path,
              accent: selected.has(w.path),
            }
          })}
          open
          onPick={(index) => {
            const w = shown[index]
            if (w) toggle(w.path)
          }}
          onCursor={setCursor}
          onEnter={() => {}}
        />
        <span className="muted">
          {tc("newTask", "adopt.repoLine", { path: repoPath || tc("newTask", "adopt.repoNone") })}
        </span>
        {list === null && repoPath && <span className="muted">{tc("newTask", "hint.scanningWorktrees")}</span>}
        {list !== null && shown.length === 0 && (
          <span className="muted">{tc("newTask", list.length === 0 ? "adopt.noUnlinked" : "adopt.noMatch")}</span>
        )}
        {shown.length > 0 && (
          <span className="muted">
            <Legend text={deviceHint(hint)} />
          </span>
        )}
      </div>
      {error && <p className="error">※ {error}</p>}
      <DialogActions busy={busy} submitLabel={tc("newTask", "button.create")} />
    </form>
  )
}
