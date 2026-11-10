/**
 * A read-only file or diff in the side panel (TUI `ops/preview.tsx` +
 * `preview-review.tsx`). Keys while focused, the TUI's: j/k cursor, v anchor
 * a range (or Shift+click), c add a note, x drop the note under the cursor, s send unsent
 * notes to the engine, z fold the file, r reload, q/Esc close. A click (a tap, on a phone) picks a line
 * and offers "comment"; a selection also offers "ask in chat", which puts its lines in the engine's prompt.
 * Notes wait in the tray under the diff until one send delivers them all.
 */

import { type KeyboardEvent, type MouseEvent, useEffect, useMemo, useRef, useState } from "react"
import type { DiffFileRow as ChangedFile } from "rove-bridge/protocol"
import { BridgeRequestError } from "./bridge.ts"
import { DiffScopeMenu } from "./diff-base-picker.tsx"
import { useDiffBase } from "./diff-base.ts"
import { DiffFileRow } from "./diff-file-row.tsx"
import { DiffLine, useRowHandlers } from "./diff-line.tsx"
import { DiffRowActions } from "./diff-row-actions.tsx"
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
import { OtherViewLink, useChangedLines } from "./file-mode.tsx"
import { hasWorkingDiff } from "./file-status.ts"
import { t, useLocale } from "./i18n/index.ts"
import { isTouch } from "./key-hints.ts"
import type { AppModel } from "./model.ts"
import { useNoteComposer } from "./note-composer.tsx"
import { openDiff } from "./panel-state.ts"
import { type Loaded, bridgeError, diffCacheId, load } from "./preview-load.ts"
import { lastReply, remember, requestRemembered } from "./remembered.ts"
import { requestErrorText } from "./request-error.ts"
import { type Note, type NoteState, locate, noteState } from "./review-notes.ts"
import { foldedByDefault, shapeLine } from "./review-shape.ts"
import { ReviewTray } from "./review-tray.tsx"
import { useStore } from "./store.ts"
import { termFor } from "./term-control.ts"
import { type Preview, activeStream, toast } from "./ui.ts"
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
  // A file opened from the Files tree is read as itself; its diff is a toggle away.
  const file = view.file === true
  const params = {
    taskId: view.taskId,
    path: view.path,
    scope: view.scope,
    ...(file ? { content: true } : {}),
    ...(ws ? { ignoreWhitespace: true } : {}),
    ...(custom ? { base: custom } : {}),
  }
  const cacheId = diffCacheId(model, view.taskId)
  const cached = { ...params, taskId: cacheId }
  // The diff as last read shows at once; a refresh keeps the rows on screen until the reread lands.
  const [loaded, setLoaded] = useState<Loaded | null>(() => {
    const last = lastReply<unknown>(model, "diff.file", cached)
    return last === undefined ? null : load(last, view.path, foreign)
  })
  const [notes, setNotes] = useState<readonly Note[]>(
    () => lastReply<{ notes: Note[] }>(model, "review.list", { taskId: view.taskId })?.notes ?? [],
  )
  const [changes, setChanges] = useState(() =>
    lastReply<{ base: string | null; files: ChangedFile[] }>(model, "diff.files", { taskId: cacheId }),
  )
  const [cursor, setCursor] = useState(0)
  const [anchor, setAnchor] = useState<number | null>(null)
  // A line was clicked or tapped: the cursor row that opens with the view is not an offer to comment.
  const [picked, setPicked] = useState(false)
  // A fold the reviewer chose, over the default (generated files, lockfiles and viewed files start folded).
  const [foldChoice, setFoldChoice] = useState<ReadonlyMap<string, boolean>>(new Map())
  const [sending, setSending] = useState(false)
  const [nonce, setNonce] = useState(0)
  const host = useRef<HTMLDivElement>(null)
  const c = model.client
  const connState = useStore(c.conn).state

  // biome-ignore lint/correctness/useExhaustiveDependencies: nonce is the reload trigger.
  useEffect(() => {
    let live = true
    c.request<unknown>("diff.file", params).then(
      (data) => live && setLoaded(load(remember(c, "diff.file", cached, data), view.path, foreign)),
      (err) => {
        if (!live) return
        // A ref the repository refuses must not stay chosen: it would leave this view with nothing to pick from.
        if (custom && err instanceof BridgeRequestError && err.code === "BAD_REF") {
          pickBase(null)
          toast(err.message, "error")
          return
        }
        setLoaded({ kind: "text", text: requestErrorText(err), error: true })
      },
    )
    return () => {
      live = false
    }
  }, [c, view.taskId, view.path, view.scope, ws, custom, nonce, connState])

  // biome-ignore lint/correctness/useExhaustiveDependencies: nonce is the reload trigger.
  useEffect(() => {
    let live = true
    c.request<{ base: string | null; files: ChangedFile[] }>("diff.files", { taskId: view.taskId }).then(
      (r) => live && setChanges(remember(c, "diff.files", { taskId: cacheId }, r)),
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
  const base = changes?.base ?? null
  // Only a file with uncommitted changes has a diff to flip to; an older bridge answers a file read with the diff, so there is nothing to flip.
  const flips = view.path !== "." && view.scope === "working" && hasWorkingDiff(changes?.files ?? [], view.path)
  const changedLines = useChangedLines(c, view.taskId, view.path, file && flips && !isDiff, nonce)
  // Row order is fixed per load (the view remounts per file), so position is identity.
  const rowIds = useMemo(() => rows.map((_, n) => `row-${n}`), [rows])
  const stats = useMemo(() => fileStats(rows), [rows])
  const hashes = useMemo(() => fileHashes(rows), [rows])
  const viewed = useMemo(() => viewedFiles(marks, view.taskId, hashes), [marks, view.taskId, hashes])
  // Derived, not set by an effect: the first render already leaves folded files out (a big diff is mostly
  // generated files, and rendering their rows once to fold them after froze the page).
  const folded = useMemo(() => {
    const out = new Set<string>()
    for (const path of hashes.keys()) {
      if (foldChoice.get(path) ?? (foldedByDefault(path) || viewed.has(path))) out.add(path)
    }
    return out
  }, [hashes, viewed, foldChoice])
  const setFold = (paths: Iterable<string>, closed: boolean) =>
    setFoldChoice((cur) => {
      const next = new Map(cur)
      for (const path of paths) next.set(path, closed)
      return next
    })
  const shown = useMemo(() => visibleIndexes(rows, folded), [rows, folded])
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
  // Not on mount: the first row is in view already, and asking would lay out the whole diff at once.
  const scrolled = useRef(false)
  useEffect(() => {
    if (!scrolled.current) {
      scrolled.current = true
      return
    }
    host.current?.querySelector(`[data-row="${cursor}"]`)?.scrollIntoView({ block: "nearest" })
  }, [cursor])

  const target = noteTarget(rows, cursor, anchor)
  const toggleFold = (path: string) => setFold([path], !folded.has(path))
  const files = [...stats.keys()].flatMap((i) => (rows[i]?.path ? [rows[i]?.path as string] : []))
  const shape = useMemo(() => shapeLine(stats, rows), [stats, rows])
  const allFolded = files.length > 0 && files.every((path) => folded.has(path))
  const total = [...stats.values()].reduce(
    (sum, s) => ({ added: sum.added + s.added, removed: sum.removed + s.removed }),
    { added: 0, removed: 0 },
  )
  const toggleViewed = (path: string) => {
    const next = withMark(marks, view.taskId, path, viewed.has(path) ? undefined : hashes.get(path))
    setMarks(next)
    saveMarks(next)
    // Marking folds the file and unmarking opens it again: drop any hand fold so the mark decides.
    setFoldChoice((cur) => {
      const choice = new Map(cur)
      choice.delete(path)
      return choice
    })
  }
  const toggleWs = () => {
    saveIgnoreWs(!ws)
    setWs(!ws)
  }

  const composer = useNoteComposer({
    client: c,
    taskId: view.taskId,
    rows,
    target,
    onSaved: (added) => {
      if (added) {
        setAnchor(null)
        setPicked(false)
      }
      refreshNotes()
    },
    focusView: () => host.current?.focus(),
  })
  // The note's lines come into view first, so the editor opens where the note sits.
  const editNote = (note: Note) => {
    showNote(note)
    if (view.path === "." || view.path === note.filePath) composer.edit(note)
  }
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
      setFold([note.filePath], false)
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
    if (path) setFold([path], false)
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
    } else if (k === "c" && !e.ctrlKey) composer.add()
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

  // The rows' handlers read this render's state through a ref, so the memoised rows keep one identity.
  const handlers = {
    rowClick: (i: number, e: MouseEvent) => {
      if (window.getSelection()?.isCollapsed === false) return
      // Shift+click extends a selection from the cursor, as `v` then j/k does; on a phone a tap
      // extends it once "range" started one.
      if (e.shiftKey) setAnchor((a) => a ?? cursor)
      else if (!touch || anchor === null) setAnchor(null)
      setCursor(i)
      setPicked(true)
    },
    fileClick: (i: number, path: string | null) => {
      setCursor(i)
      setAnchor(null)
      setPicked(false)
      if (path) toggleFold(path)
    },
    viewedClick: toggleViewed,
    editNote,
  }
  const stable = useRowHandlers(handlers)
  const lo = anchor === null ? cursor : Math.min(anchor, cursor)
  const hi = anchor === null ? cursor : Math.max(anchor, cursor)

  return (
    <div
      className="group/preview @container/preview flex min-h-0 min-w-0 flex-1 flex-col outline-none"
      // A file read as itself has one line number per row, not a diff's old and new.
      data-file={file && !isDiff ? "" : undefined}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the view owns its keys while focused, as the TUI's preview does
      tabIndex={0}
      ref={host}
      onKeyDown={onKey}
    >
      {flips && <OtherViewLink taskId={view.taskId} path={view.path} file={file} />}
      {isDiff && (
        <DiffToolbar
          picker={
            base !== null && (
              <DiffScopeMenu
                taskId={view.taskId}
                model={model}
                scope={view.scope}
                onScope={(scope) => openDiff({ taskId: view.taskId, path: view.path, scope })}
                base={base}
                custom={picked_}
                onPick={pickBase}
              />
            )
          }
          ignoreWs={ws}
          onToggleWs={toggleWs}
          files={files.length}
          shape={shape}
          added={total.added}
          removed={total.removed}
          viewed={viewed.size}
          allFolded={allFolded}
          onFoldAll={() => setFold(files, !allFolded)}
          onNextFile={jumpFile}
          onNextComment={placed.some(({ at }) => at) ? jumpComment : null}
        />
      )}
      <div
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto py-1.5 font-mono text-meta/normal"
        onMouseUp={selectDragged}
      >
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
                onToggleFold={stable.fileClick}
                onToggleViewed={stable.viewedClick}
              />
            )
          }
          return (
            <DiffLine
              key={rowIds[i]}
              index={i}
              row={row}
              cursor={inCursor}
              noted={covered.has(i)}
              actions={
                picked &&
                target &&
                !composer.node &&
                i === hi && (
                  <DiffRowActions
                    showRange={touch && anchor === null}
                    ranged={anchor !== null}
                    onComment={composer.add}
                    onRange={() => setAnchor(cursor)}
                    onAsk={askInChat}
                  />
                )
              }
              notes={endingAt.get(i)}
              changed={row.newNo !== null && changedLines?.has(row.newNo) === true}
              composer={i === composer.row ? composer.node : undefined}
              editId={i === composer.row ? composer.editId : undefined}
              onClick={stable.rowClick}
              onEditNote={stable.editNote}
            />
          )
        })}
        {composer.row === -1 && composer.node}
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
