/**
 * The Files pane (TUI `panes/filetree`): All = the worktree tree, Changes =
 * changed files with their status letter, scoped to the working tree or the
 * branch vs its base. Keys are the TUI pane's own, live only while the pane
 * has focus: j/k move, h/l fold, [ ] switch tab, b scope, r refresh,
 * Enter (or click) opens the file in the Mac's editor tab, d previews its diff, Shift+D the whole
 * diff, a mention `@path`, o opens media in the Mac's app.
 */

import { type KeyboardEvent, useEffect, useRef, useState } from "react"
import type { DiffFileRow, TaskRow } from "rove-bridge/protocol"
import { visibleTree } from "./file-tree.ts"
import { markHintUsed } from "./hint-state.ts"
import { t, useLocale } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { PaneKeyHint } from "./rail-chrome.tsx"
import { useStore } from "./store.ts"
import { activeStream, preview, toast, zen } from "./ui.ts"

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

interface Listing {
  readonly taskId: string
  readonly files: readonly string[]
  readonly changes: readonly DiffFileRow[]
  readonly base: string | null
}

export function FilesView({ model, task }: { model: AppModel; task: TaskRow }) {
  useLocale()
  const [tab, setTab] = useState<Tab>("changes")
  const [scope, setScope] = useState<"working" | "branch">("working")
  const [listing, setListing] = useState<Listing | null>(null)
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
    const c = model.client
    Promise.all([
      c.request<{ files: string[] }>("files.list", { taskId: task.id }),
      c.request<{ base: string | null; files: DiffFileRow[] }>("diff.files", { taskId: task.id }),
    ]).then(
      ([all, diff]) => {
        if (!live) return
        setListing({ taskId: task.id, files: all.files, changes: diff.files, base: diff.base })
        setError(null)
      },
      (err) => live && setError(err instanceof Error ? err.message : String(err)),
    )
    return () => {
      live = false
    }
  }, [model, task.id, changeKey, nonce])

  const current = listing?.taskId === task.id ? listing : null
  const branchScope = scope === "branch" && current?.base != null
  const rows: Row[] =
    tab === "all"
      ? visibleTree(current?.files ?? [], expanded).map((r) => ({
          path: r.path,
          label: r.name,
          depth: r.depth,
          dir: r.dir,
          open: r.open,
        }))
      : (current?.changes ?? [])
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
  const open = (path: string) => preview.set({ taskId: task.id, path, scope: branchScope ? "branch" : "working" })
  /** The Mac's configured editor in the task's editor tab; a file the branch deleted has nothing to edit, so it shows its diff. */
  const edit = (r: Row) => {
    if (r.status === "D") {
      open(r.path)
      return
    }
    model.client
      .request<{ tabId: string }>("file.openInEditor", { taskId: task.id, path: r.path })
      .then(async ({ tabId }) => {
        await model.refreshTabsNow()
        preview.set(null)
        model.select(task.id, tabId)
      })
      .catch((e) => toast(e instanceof Error ? e.message : String(e), "error"))
  }
  const mention = (path: string) => {
    if (!stream?.startsWith(`${task.id}::`)) {
      toast(t("files.mentionNoEngine"), "error")
      return
    }
    void model.client.request("term.input", { stream, data: `@${path} ` }).catch((e) => toast(String(e), "error"))
  }
  const openExternal = (path: string) =>
    void model.client
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
    else if (key === "b" && tab === "changes" && current?.base != null)
      setScope(scope === "working" ? "branch" : "working")
    else if (key === "r") setNonce((n) => n + 1)
    else if (key === "D" && e.shiftKey) open(".")
    else if (key === "d" && row) open(row.path)
    else if (key === "Enter" && row) {
      if (row.dir) toggle(row.path)
      else edit(row)
    } else if (key === "a" && row) mention(row.path)
    else if (key === "o" && row && !row.dir) openExternal(row.path)
    else return
    e.preventDefault()
  }

  return (
    <aside
      className="files"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the pane takes focus so its keys stay scoped to it, as in the TUI
      tabIndex={0}
      ref={pane}
      onKeyDown={(e) => {
        markHintUsed("files")
        onKey(e)
      }}
    >
      <div className="files-actions">
        <button type="button" className="link" onClick={() => zen.set(true)}>
          {t("files.zen")}
        </button>
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
          <span>{branchScope ? t("files.scopeBranch", { base: current?.base ?? "" }) : t("files.scopeWorking")}</span>
          {current?.base != null ? (
            <button type="button" className="link" onClick={() => setScope(scope === "working" ? "branch" : "working")}>
              {t("files.toggleScope")}
            </button>
          ) : (
            current && <span>{t("files.noBase")}</span>
          )}
          <span>{t("files.legend")}</span>
          <button type="button" className="link" onClick={() => open(".")}>
            {t("files.diffAll")}
          </button>
        </div>
      )}
      <div className="files-body">
        {error && <p className="error mono">{error}</p>}
        {!error && current && rows.length === 0 && (
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
              else edit(r)
            }}
          >
            {r.status ? (
              <span className={`glyph status-${r.status === "?" ? "untracked" : r.status}`}>{r.status}</span>
            ) : (
              <span className="glyph tone-muted">{r.dir ? (r.open ? "▾" : "▸") : " "}</span>
            )}
            <span className="row-title">{r.label}</span>
            {r.added ? <span className="chip tone-diff-added">+{r.added}</span> : null}
            {r.deleted ? <span className="chip tone-diff-removed">−{r.deleted}</span> : null}
          </button>
        ))}
      </div>
      <PaneKeyHint pane="files" />
    </aside>
  )
}
