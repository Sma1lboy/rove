/**
 * The Files pane (TUI `panes/filetree`): All = the worktree tree, Changes =
 * changed files with their status letter, scoped to the working tree or the
 * branch vs its base. Keys are the TUI pane's own, live only while the pane
 * has focus: j/k move, h/l fold, [ ] switch tab, b scope, r refresh,
 * Enter, d or a click previews the file in a tab on the right (web only: the TUI opens its editor tab), Shift+D the
 * whole diff, a mention `@path`, o opens media in the Mac's app.
 */

import { type KeyboardEvent, useEffect, useRef, useState } from "react"
import type { DiffFileRow, TaskRow } from "rove-bridge/protocol"
import { Chevron } from "./chevron.tsx"
import { visibleTree } from "./file-tree.ts"
import { t, useLocale } from "./i18n/index.ts"
import { isTouch } from "./key-hints.ts"
import { Legend } from "./legend.tsx"
import type { AppModel } from "./model.ts"
import { openDiff } from "./panel-state.ts"
import { lastReply, requestRemembered } from "./remembered.ts"
import { useStore } from "./store.ts"
import { activeStream, toast } from "./ui.ts"

type Tab = "all" | "changes"

interface Row {
  readonly path: string
  readonly label: string
  readonly depth: number
  readonly dir: boolean
  readonly open: boolean
  readonly status?: string
  readonly added?: number | null
  readonly deleted?: number | null
}

interface DiffReply {
  readonly base: string | null
  readonly files: readonly DiffFileRow[]
}

/** `narrow`: the phone's full-panel list. */
export function FilesView({ model, task, narrow = false }: { model: AppModel; task: TaskRow; narrow?: boolean }) {
  const touch = isTouch()
  useLocale()
  const [tab, setTab] = useState<Tab>("all")
  const [scope, setScope] = useState<"working" | "branch">("working")
  // The tree and the changes load apart: the tree is one `git ls-files`, the changes several git calls.
  const [files, setFiles] = useState<readonly string[] | null>(
    () => lastReply<{ files: string[] }>(model, "files.list", { taskId: task.id })?.files ?? null,
  )
  const [diff, setDiff] = useState<DiffReply | null>(
    () => lastReply<DiffReply>(model, "diff.files", { taskId: task.id }) ?? null,
  )
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [cursor, setCursor] = useState(0)
  const [nonce, setNonce] = useState(0)
  const pane = useRef<HTMLDivElement>(null)
  const stream = useStore(activeStream)
  // The feed's change counts move whenever the worktree does: refetch then, like the TUI's watcher.
  const changeKey = JSON.stringify(task.changes ?? null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: changeKey and nonce are refetch triggers.
  useEffect(() => {
    let live = true
    const failed = (err: unknown) => live && setError(err instanceof Error ? err.message : String(err))
    requestRemembered<{ files: string[] }>(model, "files.list", { taskId: task.id }).then((r) => {
      if (!live) return
      setFiles(r.files)
      setError(null)
    }, failed)
    requestRemembered<DiffReply>(model, "diff.files", { taskId: task.id }).then((r) => live && setDiff(r), failed)
    return () => {
      live = false
    }
  }, [model, task.id, changeKey, nonce])

  // The panel remounts per task, so `files` and `diff` are always this task's.
  const base = diff?.base ?? null
  const loaded = tab === "all" ? files !== null : diff !== null
  const branchScope = scope === "branch" && base != null
  const rows: Row[] =
    tab === "all"
      ? visibleTree(files ?? [], expanded).map((r) => ({
          path: r.path,
          label: r.name,
          depth: r.depth,
          dir: r.dir,
          open: r.open,
        }))
      : (diff?.files ?? [])
          .filter((f) => f.scope === (branchScope ? "branch" : "working"))
          .map((f) => ({
            path: f.path,
            label: f.path,
            depth: 0,
            dir: false,
            open: false,
            status: f.status,
            added: f.added,
            deleted: f.deleted,
          }))
  const at = Math.min(cursor, Math.max(0, rows.length - 1))
  const row = rows[at]

  const toggle = (path: string, open?: boolean) =>
    setExpanded((cur) => {
      const next = new Set(cur)
      if (open ?? !next.has(path)) next.add(path)
      else next.delete(path)
      return next
    })
  // A preview tab on the right: the file (its uncommitted diff when it has one). The branch scope is the Changes tab's alone.
  const open = (path: string) =>
    openDiff({ taskId: task.id, path, scope: tab === "changes" && branchScope ? "branch" : "working" })
  const mention = (path: string) => {
    if (!stream?.startsWith(`${task.id}::`)) {
      toast(t("files.mentionNoEngine"), "error")
      return
    }
    void model.client.request("term.input", { stream, data: `@${path} ` }).catch((e) => toast(String(e), "error"))
  }
  const openExternal = (path: string) =>
    task.machine
      ? toast(t("files.remoteNoExternal", { host: task.machine.label }), "error")
      : void model.client
          .request("file.openExternal", { taskId: task.id, path })
          .then(() => toast(t("taskops.openedExternal")))
          .catch((e) => toast(e instanceof Error ? e.message : String(e), "error"))
  const requestPR = () =>
    void model.client
      .request("tab.requestPR", model.engineTarget(task.id))
      .then(() => toast(t("files.prRequested")))
      .catch((e) => toast(e instanceof Error ? e.message : String(e), "error"))

  const onKey = (e: KeyboardEvent) => {
    const key = e.key
    if (key === "j" || key === "ArrowDown") setCursor(Math.min(rows.length - 1, at + 1))
    else if (key === "k" || key === "ArrowUp") setCursor(Math.max(0, at - 1))
    else if ((key === "l" || key === "ArrowRight") && row?.dir) toggle(row.path, true)
    else if ((key === "h" || key === "ArrowLeft") && row?.dir) toggle(row.path, false)
    else if (key === "[" || key === "]") setTab(tab === "all" ? "changes" : "all")
    else if (key === "b" && tab === "changes" && base != null) setScope(scope === "working" ? "branch" : "working")
    else if (key === "r") setNonce((n) => n + 1)
    else if (key === "D" && e.shiftKey) open(".")
    else if (key === "d" && row) open(row.path)
    else if (key === "Enter" && row) {
      if (row.dir) toggle(row.path)
      else open(row.path)
    } else if (key === "a" && row) mention(row.path)
    else if (key === "o" && row && !row.dir) openExternal(row.path)
    else return
    e.preventDefault()
  }

  return (
    <div
      className={`files ${narrow ? "is-narrow" : ""}`}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the pane takes focus so its keys stay scoped to it, as in the TUI
      tabIndex={0}
      ref={pane}
      onKeyDown={onKey}
    >
      <div className="files-actions">
        <button type="button" className="link" onClick={requestPR}>
          {t("files.createPR")}
        </button>
      </div>
      <div className="files-tabs" role="tablist">
        {(["all", "changes"] as const).map((id) => (
          <button
            type="button"
            role="tab"
            key={id}
            aria-selected={tab === id}
            className={`files-tab ${tab === id ? "is-active" : ""}`}
            onClick={() => {
              setTab(id)
              setCursor(0)
            }}
          >
            {t(id === "all" ? "files.all" : "files.changes")}
          </button>
        ))}
      </div>
      {tab === "changes" && (
        <div className="files-scope">
          <span>{branchScope ? t("files.scopeBranch", { base: base ?? "" }) : t("files.scopeWorking")}</span>
          {base != null ? (
            <button type="button" className="link" onClick={() => setScope(scope === "working" ? "branch" : "working")}>
              {t(touch ? "files.toggleScopeTouch" : "files.toggleScope")}
            </button>
          ) : (
            diff && <span>{t("files.noBase")}</span>
          )}
          <Legend text={t("files.legend")} />
          <button type="button" className="link" onClick={() => open(".")}>
            {t(touch ? "files.diffAllTouch" : "files.diffAll")}
          </button>
        </div>
      )}
      <div className="files-body">
        {error && <p className="error mono">{error}</p>}
        {!error && loaded && rows.length === 0 && (
          <p className="placeholder-line">{tab === "all" ? t("files.emptyAll") : t("files.emptyChanges")}</p>
        )}
        {rows.map((r, i) => (
          <button
            type="button"
            key={r.path}
            className={`row file-row ${i === at ? "is-selected" : ""}`}
            style={{ paddingLeft: 8 + r.depth * 14 }}
            title={r.path}
            onClick={() => {
              setCursor(i)
              pane.current?.focus()
              if (r.dir) toggle(r.path)
              else open(r.path)
            }}
          >
            {r.status ? (
              <span className={`glyph status-${r.status === "?" ? "untracked" : r.status}`}>{r.status}</span>
            ) : (
              <span className="glyph tone-muted file-fold">{r.dir ? <Chevron right={!r.open} /> : null}</span>
            )}
            <span className="row-title">{r.label}</span>
            {r.added ? <span className="chip tone-diff-added">+{r.added}</span> : null}
            {r.deleted ? <span className="chip tone-diff-removed">−{r.deleted}</span> : null}
          </button>
        ))}
      </div>
    </div>
  )
}
