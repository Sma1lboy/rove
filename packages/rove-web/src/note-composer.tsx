/** The note editor that opens under the selected line(s) of a diff or file, in place of a dialog: add a note, or edit one where it sits. */

import { type ReactNode, useState } from "react"
import type { BridgeClient } from "./bridge.ts"
import type { DiffRow, NoteTarget } from "./diff.ts"
import { t } from "./i18n/index.ts"
import { bridgeError } from "./preview-load.ts"
import { type Note, locate, noteLabel, quoteRows } from "./review-notes.ts"
import { Button } from "./ui/button.tsx"
import { diffRowClass } from "./ui/diff-row.ts"
import { TEXTAREA } from "./ui/form.ts"
import { INPUT } from "./ui/text.ts"

/** What is being written: a new note on a selection, or the text of one that exists. */
type Composing = { readonly kind: "add"; readonly target: NoteTarget } | { readonly kind: "edit"; readonly note: Note }

export interface NoteComposerHandle {
  /** The editor to draw, or null while none is open. */
  readonly node: ReactNode
  /** The row it sits under (the note's or selection's last); -1 = after the last row (a note whose lines are not on screen); null = closed. */
  readonly row: number | null
  /** The note being edited: its line gives way to the editor. */
  readonly editId: string | undefined
  add: () => void
  edit: (note: Note) => void
}

/** The editor's state for one diff or file view: what it is writing, where it sits, and the save that follows. */
export function useNoteComposer(o: {
  client: BridgeClient
  taskId: string
  rows: readonly DiffRow[]
  /** The selection a new note would be on. */
  target: NoteTarget | null
  /** A note was written: the view rereads its notes (and, for a new one, drops the selection). */
  onSaved: (added: boolean) => void
  /** Where the keys go when the editor closes. */
  focusView: () => void
}): NoteComposerHandle {
  const [composing, setComposing] = useState<Composing | null>(null)
  const close = () => {
    setComposing(null)
    o.focusView()
  }
  const save = async (body: string) => {
    if (!composing) return
    if (composing.kind === "add") {
      const { target } = composing
      await o.client.request("review.add", {
        taskId: o.taskId,
        filePath: target.path,
        line: target.line,
        ...(target.startLine ? { startLine: target.startLine } : {}),
        code: quoteRows(o.rows, target.first, target.last),
        body,
      })
    } else {
      await o.client.request("review.edit", { taskId: o.taskId, id: composing.note.id, body }).catch((e) => {
        throw bridgeError(e)
      })
    }
    o.onSaved(composing.kind === "add")
    close()
  }
  const node = composing && (
    <NoteComposer
      location={
        composing.kind === "add"
          ? noteLabel({
              filePath: composing.target.path,
              startLine: composing.target.startLine,
              line: composing.target.line,
            })
          : noteLabel(composing.note)
      }
      {...(composing.kind === "edit" ? { initial: composing.note.body } : {})}
      onSubmit={save}
      onCancel={close}
    />
  )
  return {
    node,
    row: !composing
      ? null
      : composing.kind === "add"
        ? composing.target.last
        : (locate(composing.note, o.rows)?.last ?? -1),
    editId: composing?.kind === "edit" ? composing.note.id : undefined,
    add: () => o.target && setComposing({ kind: "add", target: o.target }),
    edit: (note) => setComposing({ kind: "edit", note }),
  }
}

/** Keys and clicks stay here: the view around it takes j/k/c/x/s/q and Esc as commands. */
export function NoteComposer(props: {
  /** Where the note sits, as the tray words it (`src/a.ts:12-14`). */
  location: string
  initial?: string
  onSubmit: (body: string) => Promise<void>
  onCancel: () => void
}) {
  const [value, setValue] = useState(props.initial ?? "")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const editing = props.initial !== undefined
  const body = value.trim()
  const submit = async () => {
    if (!body || busy) return
    setBusy(true)
    setError(null)
    try {
      await props.onSubmit(body)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }
  return (
    <div
      className={diffRowClass("note", { cursor: false, noted: false })}
      onKeyDown={(e) => e.stopPropagation()}
      onMouseUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <span />
      <span />
      <span className="text-accent">●</span>
      <div className="flex min-w-0 flex-col gap-1.5 whitespace-normal">
        <textarea
          className={`${INPUT} ${TEXTAREA} font-mono`}
          aria-label={t(editing ? "review.noteEditOn" : "review.noteOn", { location: props.location })}
          // biome-ignore lint/a11y/noAutofocus: opened by the reviewer's own click or key, for typing
          autoFocus
          rows={3}
          value={value}
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
          onFocus={(e) => e.currentTarget.setSelectionRange(value.length, value.length)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              void submit()
            } else if (e.key === "Escape") {
              e.preventDefault()
              props.onCancel()
            }
          }}
        />
        {error && <p className="m-0 text-error">{error}</p>}
        <div className="flex items-center gap-3">
          <Button hit="tight" disabled={busy || !body} onClick={() => void submit()}>
            {t(editing ? "review.noteSave" : "review.noteAdd")}
          </Button>
          <Button hit="tight" className="text-muted" disabled={busy} onClick={props.onCancel}>
            {t("review.noteCancel")}
          </Button>
        </div>
      </div>
    </div>
  )
}
