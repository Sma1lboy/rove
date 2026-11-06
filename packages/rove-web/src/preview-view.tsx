/**
 * A read-only file or diff in the side panel (TUI `ops/preview.tsx` +
 * `preview-review.tsx`). Keys while focused, the TUI's: j/k cursor, v anchor
 * a range (or Shift+click), c add a note, x drop the note under the cursor, s send unsent
 * notes to the engine, z fold the file, r reload, q/Esc close. A click (a tap, on a phone) picks a line
 * and offers "comment"; a selection also offers "ask in chat", which puts its lines in the engine's prompt.
 * Notes wait in the tray under the diff until one send delivers them all.
 */

import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react"
import { TextDialog } from "./dialogs.tsx"
import { DiffBasePicker } from "./diff-base-picker.tsx"
import { useDiffBase } from "./diff-base.ts"
import { DiffFileRow } from "./diff-file-row.tsx"
import { DiffNoteLine, DiffRowActions } from "./diff-row-actions.tsx"
import { DiffToolbar } from "./diff-toolbar.tsx"
import {
  fileHashes,
  loadIgnoreWs,
  loadMarks,
  nextAfter,
  saveIgnoreWs,
  saveMarks,
  viewedFiles,
  withMark,
} from "./diff-viewed.ts"
import { type DiffRow, chatReference, fileStats, noteRange, noteTarget, visibleIndexes } from "./diff.ts"
import { t, useLocale } from "./i18n/index.ts"
import { isTouch } from "./key-hints.ts"
import type { AppModel } from "./model.ts"
import type { DiffScope } from "./panel-model.ts"
import { openDiff } from "./panel-state.ts"
import { type Loaded, bridgeError, load } from "./preview-load.ts"
import { lastReply, requestRemembered } from "./remembered.ts"
import { type Note, type NoteState, locate, noteLabel, noteState, quoteRows } from "./review-notes.ts"
import { ReviewTray } from "./review-tray.tsx"
import { useStore } from "./store.ts"
import { termFor } from "./term-control.ts"
import { type Preview, activeStream, dialog, toast } from "./ui.ts"
import { DIFF_GUTTER, diffCodeClass, diffRowClass, diffSignClass } from "./ui/diff-row.ts"
import { PLACEHOLDER_LINE } from "./ui/text.ts"

const NO_ROWS: DiffRow[] = []

export function PreviewView({
  model,
  view,
  active,
  restored,
  onClose,
}: { model: AppModel; view: Preview; active: boolean; restored: boolean; onClose: () => void }) {
  useLocale()
  const touch = isTouch()
  const [ws, setWs] = useState(loadIgnoreWs)
  const [marks, setMarks] = useState(loadMarks)
  const [picked_, pickBase] = useDiffBase(view)
  // A base chosen by hand only means something to the whole-task scope.
  const custom = view.scope === "task" ? picked_ : null
  const foreign = custom !== null
  const params = {
    taskId: view.taskId,
    path: view.path,
    scope: view.scope,
    ...(ws ? { ignoreWhitespace: true } : {}),
    ...(custom ? { base: custom } : {}),
  }
  // The diff as last read shows at once; a refresh keeps the rows on screen until the reread lands.
  const [loaded, setLoaded] = useState<Loaded | null>(() => {
    const last = lastReply<unknown>(model, "diff.file", params)
    return last === undefined ? null : load(last, view.path, foreign)
  })
  const [notes, setNotes] = useState<readonly Note[]>(
    () => lastReply<{ notes: Note[] }>(model, "review.list", { taskId: view.taskId })?.notes ?? [],
  )
  const [base, setBase] = useState<string | null>(
    () => lastReply<{ base: string | null }>(model, "diff.files", { taskId: view.taskId })?.base ?? null,
  )
  const [cursor, setCursor] = useState(0)
  const [anchor, setAnchor] = useState<number | null>(null)
  // A line was clicked or tapped: the cursor row that opens with the view is not an offer to comment.
  const [picked, setPicked] = useState(false)
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set())
  const [sending, setSending] = useState(false)
  const [nonce, setNonce] = useState(0)
  const host = useRef<HTMLDivElement>(null)
  const c = model.client

  // biome-ignore lint/correctness/useExhaustiveDependencies: nonce is the reload trigger.
  useEffect(() => {
    let live = true
    requestRemembered<unknown>(c, "diff.file", params).then(
      (data) => live && setLoaded(load(data, view.path, foreign)),
      (err) => live && setLoaded({ kind: "text", text: err instanceof Error ? err.message : String(err), error: true }),
    )
    return () => {
      live = false
    }
  }, [c, view.taskId, view.path, view.scope, ws, custom, nonce])

  // biome-ignore lint/correctness/useExhaustiveDependencies: nonce is the reload trigger.
  useEffect(() => {
    let live = true
    requestRemembered<{ base: string | null }>(c, "diff.files", { taskId: view.taskId }).then(
      (r) => live && setBase(r.base),
      () => {},
    )
    return () => {
      live = false
    }
  }, [c, view.taskId, nonce])

  const refreshNotes = () =>
    void requestRemembered<{ notes: Note[] }>(c, "review.list", { taskId: view.taskId }).then((r) => setNotes(r.notes))
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload with the view.
  useEffect(refreshNotes, [c, view.taskId, nonce])
  // A tab brought to the front takes the keys; one restored when the page loaded leaves them where they were.
  const mounted = useRef(false)
  useEffect(() => {
    if (active && (mounted.current || !restored)) host.current?.focus()
    mounted.current = true
  }, [active, restored])

  const rows = loaded?.kind === "rows" ? loaded.rows : NO_ROWS
  const isDiff = loaded?.kind === "rows" && loaded.diff
  // Row order is fixed per load (the view remounts per file), so position is identity.
  const rowIds = useMemo(() => rows.map((_, n) => `row-${n}`), [rows])
  const shown = useMemo(() => visibleIndexes(rows, folded), [rows, folded])
  const stats = useMemo(() => fileStats(rows), [rows])
  const hashes = useMemo(() => fileHashes(rows), [rows])
  const viewed = useMemo(() => viewedFiles(marks, view.taskId, hashes), [marks, view.taskId, hashes])
  // A file marked viewed folds; one that stops being viewed (unmarked, or its diff changed) opens again.
  const wasViewed = useRef<ReadonlySet<string>>(new Set())
  useEffect(() => {
    const before = wasViewed.current
    wasViewed.current = viewed
    const added = [...viewed].filter((p) => !before.has(p))
    const removed = [...before].filter((p) => !viewed.has(p))
    if (added.length === 0 && removed.length === 0) return
    setFolded((cur) => new Set([...[...cur].filter((p) => !removed.includes(p)), ...added]))
  }, [viewed])
  // Notes handed to the engine are done with; the rest wait in the tray.
  const unsent = useMemo(() => notes.filter((n) => n.sentAt === undefined), [notes])
  const placed = useMemo(() => unsent.map((note) => ({ note, at: locate(note, rows) })), [unsent, rows])
  const covered = useMemo(() => {
    const set = new Set<number>()
    for (const { at } of placed) if (at) for (let i = at.first; i <= at.last; i++) set.add(i)
    return set
  }, [placed])
  const endingAt = useMemo(() => {
    const byRow = new Map<number, Note[]>()
    for (const { note, at } of placed) if (at) byRow.set(at.last, [...(byRow.get(at.last) ?? []), note])
    return byRow
  }, [placed])
  // Every changed file is on screen only in the whole-worktree view, once it has loaded.
  const whole = view.path === "." && loaded !== null && !(loaded.kind === "text" && loaded.error)
  const states = useMemo(() => {
    const byNote = new Map<string, NoteState>()
    for (const { note } of placed) byNote.set(note.id, noteState(note, rows, whole))
    return byNote
  }, [placed, rows, whole])

  // A fold that hides the cursor moves it to the file's header.
  useEffect(() => {
    if (shown.includes(cursor)) return
    let i = cursor
    while (i > 0 && rows[i]?.kind !== "file") i--
    setCursor(i)
    setAnchor(null)
  }, [shown, cursor, rows])
  useEffect(() => {
    host.current?.querySelector(`[data-row="${cursor}"]`)?.scrollIntoView({ block: "nearest" })
  }, [cursor])

  const target = noteTarget(rows, cursor, anchor)
  const toggleFold = (path: string) =>
    setFolded((cur) => {
      const next = new Set(cur)
      if (!next.delete(path)) next.add(path)
      return next
    })
  const files = [...stats.keys()].flatMap((i) => (rows[i]?.path ? [rows[i]?.path as string] : []))
  const allFolded = files.length > 0 && files.every((path) => folded.has(path))
  const total = [...stats.values()].reduce(
    (sum, s) => ({ added: sum.added + s.added, removed: sum.removed + s.removed }),
    { added: 0, removed: 0 },
  )
  const toggleViewed = (path: string) => {
    const next = withMark(marks, view.taskId, path, viewed.has(path) ? undefined : hashes.get(path))
    setMarks(next)
    saveMarks(next)
  }
  const toggleWs = () => {
    saveIgnoreWs(!ws)
    setWs(!ws)
  }

  const addNote = () => {
    if (!target) return
    const location = noteLabel({ filePath: target.path, startLine: target.startLine, line: target.line })
    dialog.set(
      <TextDialog
        multiline
        title={t("preview.noteTitle", { location })}
        submitLabel={t("preview.noteSubmit")}
        onSubmit={async (body) => {
          await c.request("review.add", {
            taskId: view.taskId,
            filePath: target.path,
            line: target.line,
            ...(target.startLine ? { startLine: target.startLine } : {}),
            code: quoteRows(rows, target.first, target.last),
            body,
          })
          setAnchor(null)
          setPicked(false)
          refreshNotes()
          host.current?.focus()
        }}
      />,
    )
  }
  const editNote = (note: Note) =>
    dialog.set(
      <TextDialog
        multiline
        title={t("review.editTitle", { location: noteLabel(note) })}
        initial={note.body}
        submitLabel={t("review.editSubmit")}
        onSubmit={async (body) => {
          await c.request("review.edit", { taskId: view.taskId, id: note.id, body }).catch((e) => {
            throw bridgeError(e)
          })
          refreshNotes()
          host.current?.focus()
        }}
      />,
    )
  const dropNote = (note: Note) =>
    void c
      .request("review.remove", { taskId: view.taskId, id: note.id })
      .then(refreshNotes)
      .catch((e) => toast(bridgeError(e).message, "error"))
  // The selection as a reference in the task's engine prompt, then the prompt takes the keys to ask about it.
  const stream = useStore(activeStream)
  const askInChat = () => {
    const range = noteRange(rows, cursor, anchor)
    if (!range) return
    if (!stream?.startsWith(`${view.taskId}::`)) {
      toast(t("files.mentionNoEngine"), "error")
      return
    }
    void c
      .request("term.input", { stream, data: chatReference(range) })
      .then(() => {
        setAnchor(null)
        termFor(stream)?.focus()
      })
      .catch((e) => toast(e instanceof Error ? e.message : String(e), "error"))
  }
  // From the tray: the note's lines when they are on screen, else the file where they were.
  const showNote = (note: Note) => {
    const at = locate(note, rows)
    const header = rows.findIndex((row) => row.kind === "file" && row.path === note.filePath)
    if (at) {
      setFolded((cur) => new Set([...cur].filter((path) => path !== note.filePath)))
      setCursor(at.first)
    } else if (view.path === "." && header >= 0) setCursor(header)
    else if (view.path !== note.filePath && view.path !== ".")
      openDiff({ taskId: view.taskId, path: note.filePath, scope: view.scope })
    setAnchor(null)
    setPicked(false)
  }
  const send = () => {
    setSending(true)
    void c
      .request<{ sent: number; delivered: boolean; reason?: string }>("review.send", model.engineTarget(view.taskId))
      .then((r) => {
        toast(
          r.delivered ? t("preview.sent", { count: r.sent }) : t("preview.notSent", { reason: r.reason ?? "" }),
          r.delivered ? "info" : "error",
        )
        refreshNotes()
      })
      .catch((e) => toast(e instanceof Error ? e.message : String(e), "error"))
      .finally(() => setSending(false))
  }

  const jumpFile = () => {
    const next = nextAfter([...stats.keys()], cursor)
    if (next === null) return
    setCursor(next)
    setAnchor(null)
    setPicked(false)
  }
  const jumpComment = () => {
    const next = nextAfter(
      placed.flatMap(({ at }) => (at ? [at.first] : [])).sort((a, b) => a - b),
      cursor,
    )
    if (next === null) return
    const path = rows[next]?.path
    if (path) setFolded((cur) => new Set([...cur].filter((p) => p !== path)))
    setCursor(next)
    setAnchor(null)
    setPicked(false)
  }
  const step = (by: 1 | -1) =>
    setCursor((cur) => {
      const at = Math.max(0, shown.indexOf(cur))
      return shown[Math.min(shown.length - 1, Math.max(0, at + by))] ?? cur
    })
  const onKey = (e: KeyboardEvent) => {
    const k = e.key
    if (k === "j" || k === "ArrowDown") step(1)
    else if (k === "k" || k === "ArrowUp") step(-1)
    else if (k === "v") {
      setAnchor((a) => (a === null ? cursor : null))
      setPicked(true)
    } else if (k === "c" && !e.ctrlKey) addNote()
    else if (k === "x") {
      const hit = placed.find(({ at }) => at && cursor >= at.first && cursor <= at.last)
      if (hit) dropNote(hit.note)
    } else if (k === "s") send()
    else if (k === "z") {
      const path = rows[cursor]?.path
      if (path && isDiff) toggleFold(path)
    } else if (k === "r") setNonce((n) => n + 1)
    else if (k === "q" || k === "Escape") onClose()
    // Ctrl+C closes it as the TUI's preview does; a text selection keeps the browser's own copy.
    else if (e.ctrlKey && !e.metaKey && k.toLowerCase() === "c" && !window.getSelection()?.toString()) onClose()
    else return
    e.preventDefault()
  }

  // A mouse drag across lines selects them as `v` does.
  const selectDragged = () => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) return
    const rowOf = (n: Node | null) => (n instanceof Element ? n : n?.parentElement)?.closest<HTMLElement>("[data-row]")
    const from = rowOf(sel.anchorNode)
    const to = rowOf(sel.focusNode)
    if (!from || !to) return
    setAnchor(Number(from.dataset.row))
    setCursor(Number(to.dataset.row))
    setPicked(true)
  }

  const lo = anchor === null ? cursor : Math.min(anchor, cursor)
  const hi = anchor === null ? cursor : Math.max(anchor, cursor)
  const scopes: { id: DiffScope; label: string }[] = [
    { id: "working", label: t("review.scopeWorking") },
    { id: "branch", label: t("review.scopeBranch") },
    { id: "task", label: t("review.scopeTask", { base: picked_ ?? base ?? "" }) },
  ]

  return (
    <div
      className="group/preview flex min-h-0 min-w-0 flex-1 flex-col outline-none"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the view owns its keys while focused, as the TUI's preview does
      tabIndex={0}
      ref={host}
      onKeyDown={onKey}
    >
      {isDiff && (
        <DiffToolbar
          scopes={base !== null ? scopes : null}
          scope={view.scope}
          onScope={(scope) => openDiff({ taskId: view.taskId, path: view.path, scope })}
          picker={
            base !== null && (
              <DiffBasePicker taskId={view.taskId} model={model} base={base} custom={picked_} onPick={pickBase} />
            )
          }
          ignoreWs={ws}
          onToggleWs={toggleWs}
          files={files.length}
          added={total.added}
          removed={total.removed}
          viewed={viewed.size}
          allFolded={allFolded}
          onFoldAll={() => setFolded(allFolded ? new Set() : new Set(files))}
          onNextFile={jumpFile}
          onNextComment={placed.some(({ at }) => at) ? jumpComment : null}
        />
      )}
      <div className="min-h-0 flex-1 overflow-auto py-1.5 font-mono text-meta/normal" onMouseUp={selectDragged}>
        {!loaded && <p className={PLACEHOLDER_LINE}>{t("preview.loading")}</p>}
        {loaded?.kind === "text" && (
          <p className={`${PLACEHOLDER_LINE} ${loaded.error ? "text-error" : ""}`}>{loaded.text}</p>
        )}
        {shown.map((i) => {
          const row = rows[i] as DiffRow
          const inCursor = i >= lo && i <= hi
          if (row.kind === "file") {
            const stat = stats.get(i)
            const path = row.path
            return (
              <DiffFileRow
                key={rowIds[i]}
                index={i}
                name={row.text}
                path={path}
                closed={path !== null && folded.has(path)}
                viewed={path !== null && viewed.has(path)}
                cursor={inCursor}
                added={stat?.added ?? 0}
                removed={stat?.removed ?? 0}
                onToggleFold={() => {
                  setCursor(i)
                  setAnchor(null)
                  setPicked(false)
                  if (path) toggleFold(path)
                }}
                onToggleViewed={() => path && toggleViewed(path)}
              />
            )
          }
          const noted = covered.has(i)
          return (
            <div key={rowIds[i]}>
              {/* biome-ignore lint/a11y/useKeyWithClickEvents: the view's keys (j/k) move the cursor */}
              <div
                data-row={i}
                className={diffRowClass(row.kind, { cursor: inCursor, noted })}
                onClick={(e) => {
                  if (window.getSelection()?.isCollapsed === false) return
                  // Shift+click extends a selection from the cursor, as `v` then j/k does; on a phone a tap
                  // extends it once "range" started one.
                  if (e.shiftKey) setAnchor((a) => a ?? cursor)
                  else if (!touch || anchor === null) setAnchor(null)
                  setCursor(i)
                  setPicked(true)
                }}
              >
                <span className={DIFF_GUTTER}>{row.oldNo ?? ""}</span>
                <span className={DIFF_GUTTER}>{row.newNo ?? ""}</span>
                <span className={diffSignClass(row.kind, noted)}>
                  {row.kind === "add" ? "+" : row.kind === "del" ? "−" : noted ? "●" : " "}
                </span>
                <span className={diffCodeClass(row.kind)}>{row.text}</span>
                {picked && target && i === hi && (
                  <DiffRowActions
                    showRange={touch && anchor === null}
                    ranged={anchor !== null}
                    onComment={addNote}
                    onRange={() => setAnchor(cursor)}
                    onAsk={askInChat}
                  />
                )}
              </div>
              {endingAt.get(i)?.map((note) => (
                <DiffNoteLine key={note.id} note={note} onEdit={() => editNote(note)} />
              ))}
            </div>
          )
        })}
      </div>
      <ReviewTray
        notes={unsent}
        states={states}
        sending={sending}
        onShow={showNote}
        onEdit={editNote}
        onDrop={dropNote}
        onSend={send}
      />
    </div>
  )
}
