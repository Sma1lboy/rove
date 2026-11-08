/**
 * The Files pane (TUI `panes/filetree`): the worktree tree, each changed file coloured by its git status (a directory
 * by the strongest beneath it). Keys are the TUI pane's own, live only while the pane has focus: j/k move, h/l fold, r
 * refresh, Enter or a click opens the file in a tab on the right (web only: the TUI opens its editor tab), d its
 * diff, Shift+D the whole diff, a mention `@path`, o opens media in the Mac's app.
 */

import { type KeyboardEvent, useEffect, useRef, useState } from "react"
import type { DiffFileRow, TaskRow } from "rove-bridge/protocol"
import { ChecksSection } from "./checks-section.tsx"
import { type FileState, STATE_LETTER, STATE_TONE, treeStates } from "./file-status.ts"
import { visibleTree } from "./file-tree.ts"
import { t, useLocale } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { openDiff, openFile } from "./panel-state.ts"
import { PrStrip } from "./pr-strip.tsx"
import { lastReply, requestRemembered } from "./remembered.ts"
import { RunStrip } from "./run-strip.tsx"
import { useStore } from "./store.ts"
import { activeStream, toast } from "./ui.ts"
import { Chevron } from "./ui/chevron.tsx"
import { GLYPH, ROW_TITLE, rowClass } from "./ui/row.ts"
import { PLACEHOLDER_LINE } from "./ui/text.ts"
import { TONE } from "./ui/tone.ts"

interface Row {
  readonly path: string
  readonly label: string
  readonly depth: number
  readonly dir: boolean
  readonly open: boolean
  readonly state: FileState | undefined
}

/** `narrow`: the phone's full-panel list. */
export function FilesView({ model, task, narrow = false }: { model: AppModel; task: TaskRow; narrow?: boolean }) {
  useLocale()
  const [files, setFiles] = useState<readonly string[] | null>(
    () => lastReply<{ files: string[] }>(model, "files.list", { taskId: task.id })?.files ?? null,
  )
  const [states, setStates] = useState<ReadonlyMap<string, FileState>>(() =>
    treeStates(lastReply<{ files: DiffFileRow[] }>(model, "diff.files", { taskId: task.id })?.files ?? []),
  )
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [cursor, setCursor] = useState(0)
  const [nonce, setNonce] = useState(0)
  const pane = useRef<HTMLDivElement>(null)
  const stream = useStore(activeStream)
  // The feed's change counts move whenever the worktree does (files come and go): refetch then, like the TUI's watcher.
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
    return () => {
      live = false
    }
  }, [model, task.id, changeKey, nonce])

  // Git status for the colours, on the same triggers; a failed read leaves the tree plain.
  // biome-ignore lint/correctness/useExhaustiveDependencies: changeKey and nonce are refetch triggers.
  useEffect(() => {
    let live = true
    requestRemembered<{ files: DiffFileRow[] }>(model, "diff.files", { taskId: task.id }).then(
      (r) => live && setStates(treeStates(r.files)),
      () => {},
    )
    return () => {
      live = false
    }
  }, [model, task.id, changeKey, nonce])

  // The panel remounts per task, so `files` is always this task's.
  const loaded = files !== null
  const rows: Row[] = visibleTree(files ?? [], expanded).map((r) => ({
    path: r.path,
    label: r.name,
    depth: r.depth,
    dir: r.dir,
    open: r.open,
    state: states.get(r.path),
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
  // The file itself in the File column; its diff is `d`, or the File column's `[ diff ]`.
  const open = (path: string) => openFile(task.id, path)
  const openChanges = (path: string) => openDiff({ taskId: task.id, path, scope: "working" })
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

  const onKey = (e: KeyboardEvent) => {
    const key = e.key
    if (key === "j" || key === "ArrowDown") setCursor(Math.min(rows.length - 1, at + 1))
    else if (key === "k" || key === "ArrowUp") setCursor(Math.max(0, at - 1))
    else if ((key === "l" || key === "ArrowRight") && row?.dir) toggle(row.path, true)
    else if ((key === "h" || key === "ArrowLeft") && row?.dir) toggle(row.path, false)
    else if (key === "r") setNonce((n) => n + 1)
    else if (key === "D" && e.shiftKey) openChanges(".")
    else if (key === "d" && row) openChanges(row.path)
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
      className={`group/pane flex min-h-0 min-w-0 flex-1 flex-col outline-none ${narrow ? "px-1.5 pt-2.5 pb-2" : "pt-0.5 pr-1.5 pb-1.5 pl-0"}`}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the pane takes focus so its keys stay scoped to it, as in the TUI
      tabIndex={0}
      ref={pane}
      onKeyDown={onKey}
    >
      <PrStrip model={model} task={task} />
      <ChecksSection model={model} task={task} />
      <RunStrip model={model} task={task} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && <p className="mono text-error">{error}</p>}
        {!error && loaded && rows.length === 0 && <p className={PLACEHOLDER_LINE}>{t("files.emptyAll")}</p>}
        {rows.map((r, i) => (
          <button
            type="button"
            key={r.path}
            className={rowClass({ selected: i === at, size: narrow ? "file-narrow" : "file" })}
            style={{ paddingLeft: 8 + r.depth * 14 }}
            title={r.path}
            onClick={() => {
              setCursor(i)
              pane.current?.focus()
              if (r.dir) toggle(r.path)
              else open(r.path)
            }}
          >
            <span className={`${GLYPH} grid place-items-center text-subtle`}>
              {r.dir ? <Chevron right={!r.open} /> : null}
            </span>
            <span className={`${ROW_TITLE} ${r.state ? TONE[STATE_TONE[r.state]] : ""}`}>{r.label}</span>
            {r.state && (
              <span className={`${GLYPH} ${TONE[STATE_TONE[r.state]]}`} title={t(`files.state.${r.state}`)}>
                {r.dir ? "•" : STATE_LETTER[r.state]}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
