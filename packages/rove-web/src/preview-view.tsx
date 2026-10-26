/**
 * A read-only file or diff in the side panel (TUI `ops/preview.tsx` +
 * `preview-review.tsx`). Keys while focused, the TUI's: j/k cursor, v anchor
 * a range, c add a note, x drop the note under the cursor, s send unsent
 * notes to the engine, r reload, q/Esc close.
 */

import { type KeyboardEvent, useEffect, useRef, useState } from "react"
import { TextDialog } from "./dialogs.tsx"
import { type DiffRow, codeRows, displayLine, noteRange, parseUnifiedDiff } from "./diff.ts"
import { t, useLocale } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { closeDiff } from "./panel-state.ts"
import { type Preview, dialog, toast } from "./ui.ts"

interface Note {
  readonly id: string
  readonly filePath: string
  readonly startLine?: number
  readonly line: number
  readonly body: string
  readonly sentAt?: number
}

type Loaded =
  | { readonly kind: "rows"; readonly rows: DiffRow[]; readonly diff: boolean }
  | { readonly kind: "text"; readonly text: string; readonly error?: boolean }

/** `diff.file` result (`PreviewData`, `tui/ops/preview-core.ts`) → what this view draws. */
function load(data: unknown, path: string): Loaded {
  if (!data || typeof data !== "object" || !("kind" in data)) return { kind: "text", text: t("preview.unknown") }
  const text = "text" in data && typeof data.text === "string" ? data.text : ""
  switch (data.kind) {
    case "diff":
      return { kind: "rows", rows: parseUnifiedDiff(text, path === "." ? null : path), diff: true }
    case "code":
      return { kind: "rows", rows: codeRows(text, path), diff: false }
    case "binary":
      return { kind: "text", text: t("preview.binary") }
    case "empty":
      return { kind: "text", text: t("preview.empty") }
    case "error":
      return { kind: "text", text: "message" in data ? String(data.message) : t("preview.unknown"), error: true }
    default:
      return { kind: "text", text: t("preview.noHunks", { kind: String(data.kind) }) }
  }
}

function covers(note: Note, row: DiffRow): boolean {
  const line = displayLine(row)
  return line !== null && note.filePath === row.path && line >= (note.startLine ?? note.line) && line <= note.line
}

export function PreviewView({ model, view }: { model: AppModel; view: Preview }) {
  useLocale()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [notes, setNotes] = useState<readonly Note[]>([])
  const [cursor, setCursor] = useState(0)
  const [anchor, setAnchor] = useState<number | null>(null)
  const [nonce, setNonce] = useState(0)
  const host = useRef<HTMLDivElement>(null)
  const c = model.client

  // biome-ignore lint/correctness/useExhaustiveDependencies: nonce is the reload trigger.
  useEffect(() => {
    let live = true
    setLoaded(null)
    c.request("diff.file", { taskId: view.taskId, path: view.path, scope: view.scope }).then(
      (data) => live && setLoaded(load(data, view.path)),
      (err) => live && setLoaded({ kind: "text", text: err instanceof Error ? err.message : String(err), error: true }),
    )
    return () => {
      live = false
    }
  }, [c, view.taskId, view.path, view.scope, nonce])

  const refreshNotes = () =>
    void c.request<{ notes: Note[] }>("review.list", { taskId: view.taskId }).then((r) => setNotes(r.notes))
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload with the view.
  useEffect(refreshNotes, [c, view.taskId, nonce])
  useEffect(() => host.current?.focus(), [])

  const rows = loaded?.kind === "rows" ? loaded.rows : []
  // Row order is fixed per load (the view remounts per file), so position is identity.
  const rowIds = rows.map((_, n) => `row-${n}`)
  useEffect(() => {
    host.current?.querySelector(`[data-row="${cursor}"]`)?.scrollIntoView({ block: "nearest" })
  }, [cursor])

  const addNote = () => {
    const range = noteRange(rows, cursor, anchor)
    if (!range) return
    const location = range.startLine ? `${range.path}:${range.startLine}-${range.line}` : `${range.path}:${range.line}`
    dialog.set(
      <TextDialog
        title={t("preview.noteTitle", { location })}
        submitLabel={t("preview.noteSubmit")}
        onSubmit={async (body) => {
          await c.request("review.add", {
            taskId: view.taskId,
            filePath: range.path,
            line: range.line,
            ...(range.startLine ? { startLine: range.startLine } : {}),
            body,
          })
          setAnchor(null)
          refreshNotes()
          host.current?.focus()
        }}
      />,
    )
  }
  const dropNote = () => {
    const row = rows[cursor]
    const note = row && notes.find((n) => covers(n, row))
    if (!note) return
    void c.request("review.remove", { taskId: view.taskId, id: note.id }).then(refreshNotes)
  }
  const send = () =>
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

  const onKey = (e: KeyboardEvent) => {
    const k = e.key
    if (k === "j" || k === "ArrowDown") setCursor((i) => Math.min(rows.length - 1, i + 1))
    else if (k === "k" || k === "ArrowUp") setCursor((i) => Math.max(0, i - 1))
    else if (k === "v") setAnchor((a) => (a === null ? cursor : null))
    else if (k === "c" && !e.ctrlKey) addNote()
    else if (k === "x") dropNote()
    else if (k === "s") send()
    else if (k === "r") setNonce((n) => n + 1)
    else if (k === "q" || k === "Escape") closeDiff(view.taskId)
    // Ctrl+C closes it as the TUI's preview does; a text selection keeps the browser's own copy.
    else if (e.ctrlKey && !e.metaKey && k.toLowerCase() === "c" && !window.getSelection()?.toString())
      closeDiff(view.taskId)
    else return
    e.preventDefault()
  }

  const unsent = notes.filter((n) => n.sentAt === undefined).length
  const here = notes.filter((n) => view.path === "." || n.filePath === view.path).length
  const lo = anchor === null ? cursor : Math.min(anchor, cursor)
  const hi = anchor === null ? cursor : Math.max(anchor, cursor)

  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: the view owns its keys while focused, as the TUI's preview does
    <div className="preview" tabIndex={0} ref={host} onKeyDown={onKey}>
      <div className="preview-body">
        {!loaded && <p className="placeholder-line">{t("preview.loading")}</p>}
        {loaded?.kind === "text" && <p className={`placeholder-line ${loaded.error ? "error" : ""}`}>{loaded.text}</p>}
        {rows.map((row, i) => {
          const noted = notes.some((n) => covers(n, row))
          return (
            // biome-ignore lint/a11y/useKeyWithClickEvents: the view's keys (j/k) move the cursor
            <div
              key={rowIds[i]}
              data-row={i}
              className={`diff-row kind-${row.kind} ${i >= lo && i <= hi ? "is-cursor" : ""} ${noted ? "is-noted" : ""}`}
              onClick={() => setCursor(i)}
            >
              <span className="gutter">{row.oldNo ?? ""}</span>
              <span className="gutter">{row.newNo ?? ""}</span>
              <span className="sign">{row.kind === "add" ? "+" : row.kind === "del" ? "−" : noted ? "●" : " "}</span>
              <span className="code">{row.text}</span>
            </div>
          )
        })}
      </div>
      <footer className="preview-footer">
        <span className="preview-keys">{t("preview.hints")}</span>
        <span className="spacer" />
        <span>{t("preview.notes", { here, unsent })}</span>
      </footer>
    </div>
  )
}
