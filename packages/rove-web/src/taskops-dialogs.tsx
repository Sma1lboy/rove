/**
 * Two row-menu dialogs: Run again (TUI `run-again-dialog.tsx`: the stored brief, verbatim,
 * before it is fired into a fresh task) and the project's Field notes (`field-notes-dialog.tsx`:
 * read, and retire with `d`).
 */

import { useEffect, useRef, useState } from "react"
import type { TaskRow } from "rove-bridge/protocol"
import { DialogActions, DialogShell, errorText, useSubmit } from "./dialogs.tsx"
import { t } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { lastReply, requestRemembered } from "./remembered.ts"
import { tc } from "./tui-copy.ts"
import { closeDialog } from "./ui.ts"
import { BRIEF, HINT, INSET_BOX, NOTES, noteClass } from "./ui/text.ts"

interface BriefTask {
  readonly prompt?: string
  readonly repo: string
  readonly engine?: string
  readonly baseRef?: string
}

/** Re-fire `task.prompt` as a NEW task from the same repo, engine and fork point; only the worktree differs. */
export function RunAgainDialog({ model, task }: { model: AppModel; task: Pick<TaskRow, "id" | "title"> }) {
  // A task's prompt never changes, so the last read stands in at once.
  const [brief, setBrief] = useState<BriefTask | null>(
    () => lastReply<{ task: BriefTask }>(model, "task.get", { taskId: task.id })?.task ?? null,
  )
  const [loadError, setLoadError] = useState<string | null>(null)
  const { busy, error, submit } = useSubmit()
  useEffect(() => {
    requestRemembered<{ task: BriefTask }>(model, "task.get", { taskId: task.id })
      .then((res) => setBrief(res.task))
      .catch((err) => setLoadError(errorText(err)))
  }, [model, task.id])

  const run = () =>
    submit(async () => {
      if (!brief?.prompt) return
      const res = await model.client.request<{ taskIds: string[] }>("task.spawn", {
        repo: brief.repo,
        prompt: brief.prompt,
        ...(brief.engine ? { engine: brief.engine } : {}),
        ...(brief.baseRef ? { baseBranch: brief.baseRef } : {}),
      })
      const created = res.taskIds[0]
      if (created) model.selectWhenListed(created)
    })

  return (
    <DialogShell title={tc("tasks", "runAgain.title")} wide>
      <form
        className="dialog-body"
        onSubmit={(e) => {
          e.preventDefault()
          void run()
        }}
      >
        <p className="muted">{tc("tasks", "runAgain.source", { title: task.title })}</p>
        <pre className={BRIEF}>{brief?.prompt ?? loadError ?? tc("tasks", "fieldNotes.loading")}</pre>
        <p className={HINT}>{tc("tasks", "runAgain.hint")}</p>
        {error && <p className="error">{error}</p>}
        <DialogActions busy={busy || !brief?.prompt} submitLabel={tc("tasks", "runAgain.confirm")} />
      </form>
    </DialogShell>
  )
}

interface FieldNote {
  readonly id?: number
  readonly at: string
  readonly author: string
  readonly text: string
}

/** ISO `at` → local time to the minute; unparseable → the raw string, not "Invalid Date". */
function formatAt(at: string): string {
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return at
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

type NotesState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly notes: readonly FieldNote[] }
  | { readonly kind: "error"; readonly message: string }

export function FieldNotesDialog({ model, repo }: { model: AppModel; repo: string }) {
  const [state, setState] = useState<NotesState>({ kind: "loading" })
  const [cursor, setCursor] = useState(0)
  const [confirming, setConfirming] = useState<FieldNote | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const list = useRef<HTMLUListElement>(null)

  const load = () =>
    model.client
      .request<{ notes: FieldNote[] }>("notes.list", { repo })
      .then((res) => setState({ kind: "ready", notes: res.notes }))
      .catch((err) => setState({ kind: "error", message: errorText(err) }))
  // biome-ignore lint/correctness/useExhaustiveDependencies: loads once per open
  useEffect(() => void load(), [])

  const notes = state.kind === "ready" ? state.notes : []
  useEffect(() => setCursor((c) => Math.max(0, Math.min(c, notes.length - 1))), [notes.length])
  // biome-ignore lint/correctness/useExhaustiveDependencies: the selected row scrolls into view as the cursor moves
  useEffect(() => {
    list.current?.querySelector(".is-selected")?.scrollIntoView({ block: "nearest" })
  }, [cursor])

  const retire = async (note: FieldNote) => {
    if (note.id === undefined) return
    setDeleteError(null)
    try {
      await model.client.request("notes.delete", { repo, id: note.id })
      setConfirming(null)
      await load()
    } catch (err) {
      setDeleteError(errorText(err))
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (confirming) return
    if (e.key === "ArrowDown" || e.key === "j") setCursor((c) => Math.min(notes.length - 1, c + 1))
    else if (e.key === "ArrowUp" || e.key === "k") setCursor((c) => Math.max(0, c - 1))
    else if (e.key === "d" && notes[cursor]?.id !== undefined) setConfirming(notes[cursor] ?? null)
    else return
    e.preventDefault()
  }

  return (
    <DialogShell title={tc("tasks", "fieldNotes.title")} wide>
      <div className="dialog-body" onKeyDown={onKeyDown}>
        <p className="font-mono text-meta break-all text-muted">{repo}</p>
        {state.kind === "loading" && <p className="muted">{tc("tasks", "fieldNotes.loading")}</p>}
        {state.kind === "error" && <p className="error">{state.message}</p>}
        {state.kind === "ready" && notes.length === 0 && <p className="muted">{tc("tasks", "fieldNotes.empty")}</p>}
        {notes.length > 0 && (
          <ul className={`choices ${NOTES}`} ref={list}>
            {notes.map((note, i) => (
              <li key={`${note.at}:${i}`}>
                <button
                  type="button"
                  className={noteClass(i === cursor)}
                  onClick={() => setCursor(i)}
                  // biome-ignore lint/a11y/noAutofocus: the reader's keys need focus inside the dialog
                  autoFocus={i === 0}
                >
                  <span className="font-mono text-meta whitespace-pre text-accent">
                    {i === cursor ? "▸ " : "  "}
                    {formatAt(note.at)}, {note.author}
                  </span>
                  <span className="text-ink whitespace-pre-wrap wrap-anywhere">{note.text}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {confirming && (
          <div className={INSET_BOX}>
            <p>
              <strong>{tc("tasks", "fieldNotes.confirmDelete.title")}</strong>
            </p>
            <p className="muted">{tc("tasks", "fieldNotes.confirmDelete.body", { text: confirming.text })}</p>
            {deleteError && <p className="error">{deleteError}</p>}
            <div className="actions">
              <button type="button" className="link" onClick={() => setConfirming(null)}>
                {t("dialog.cancel")}
              </button>
              <button type="button" className="button is-danger" onClick={() => void retire(confirming)}>
                {t("taskops.retire")}
              </button>
            </div>
          </div>
        )}
        {!confirming && (
          <>
            <p className={`keys-only ${HINT}`}>{tc("tasks", "fieldNotes.footerDeletable")}</p>
            <div className="actions">
              {/* `d`'s tap target, for the note under the cursor (a phone has no `d`). */}
              <button
                type="button"
                className="link"
                disabled={notes[cursor]?.id === undefined}
                onClick={() => setConfirming(notes[cursor] ?? null)}
              >
                {t("taskops.retire")}
              </button>
              <button type="button" className="link" onClick={closeDialog}>
                {t("taskops.close")}
              </button>
            </div>
          </>
        )}
      </div>
    </DialogShell>
  )
}
