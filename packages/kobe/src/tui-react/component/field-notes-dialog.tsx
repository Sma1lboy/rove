/** @jsxImportSource @opentui/react */
/**
 * Field-notes reader — the project row menu's "Field notes" entry. Agents file
 * durable repo-level gotchas with `rove api note`; every fresh worktree
 * session is seeded with the newest of them (`state/field-notes.ts`), but
 * until this dialog a human could only read the store from a shell
 * (`rove api note-list`).
 *
 * Read plus RETIRE. The daemon is still the store's only writer and a note is
 * still a conclusion some session paid for — but a conclusion can stop being
 * true, and the newest 15 ride into every fresh session on the repo, so a
 * stale note is not inert: later agents act on it. `d` (see below) is the
 * correction; there is no edit, because a fact that changed is a new note.
 * Each row carries the note's author and time because provenance is the
 * point — the reader's next move is usually opening the session that filed it.
 *
 * PROPOSED CHORD, pending owner sign-off (docs/KEYBINDINGS.md): `d` deletes
 * the selected note, matching the kanban board's `d` and the tasks pane's `d`.
 * It shadows nothing here — this dialog binds only navigation keys, has no
 * text input, and `d` reached the terminal underneath before this.
 *
 * Reads through the daemon's `note.list` RPC rather than the launch-path
 * reader so the dialog shows what the store holds (50) instead of the
 * 15-note injection cap.
 */

import { TextAttributes } from "@opentui/core"
import type { ScrollBoxRenderable } from "@opentui/core"
import { useEffect, useRef, useState } from "react"
import type { StoredFieldNote } from "../../state/field-notes"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import { useBindings } from "../lib/keymap"
import { useCursorFollow } from "../lib/use-cursor-follow"
import { type DialogContext, showDialog, useDialog, useDialogPaddingX } from "../ui/dialog"
import { DialogConfirm } from "../ui/dialog-confirm"

/** The two store calls {@link show} binds — named as a pair so the dialog
 *  depends on what it uses, not on the whole orchestrator. */
interface FieldNotesIO {
  listFieldNotes(repo: string): Promise<readonly StoredFieldNote[]>
  deleteFieldNote(repo: string, id: number): Promise<boolean>
}

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly notes: readonly StoredFieldNote[] }
  | { readonly kind: "error"; readonly message: string }

/** `at` is an ISO stamp; show it to the minute in local time, and fall back
 *  to the raw string for anything that does not parse rather than "Invalid Date". */
function formatAt(at: string): string {
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return at
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function FieldNotesDialogView(props: {
  /** The repo root the notes belong to — shown under the title. */
  repo: string
  load: () => Promise<readonly StoredFieldNote[]>
  /** Retire one note by id. Absent (mocks, offline) makes the list read-only:
   *  `d` binds only when there is somewhere for the delete to go. */
  remove?: (id: number) => Promise<boolean>
  onClose: () => void
}) {
  const { theme } = useTheme()
  const t = useT()
  const dialog = useDialog()
  const padX = useDialogPaddingX()
  const [state, setState] = useState<LoadState>({ kind: "loading" })
  const [cursor, setCursor] = useState(0)

  useEffect(() => {
    let live = true
    props
      .load()
      .then((notes) => {
        if (live) setState({ kind: "ready", notes })
      })
      .catch((err: unknown) => {
        if (live) setState({ kind: "error", message: err instanceof Error ? err.message : String(err) })
      })
    return () => {
      live = false
    }
  }, [props.load])

  const notes = state.kind === "ready" ? state.notes : []
  // Re-clamp whenever the row count changes — a delete at the tail would
  // otherwise leave the cursor past the end.
  useEffect(() => {
    setCursor((c) => Math.max(0, Math.min(c, notes.length - 1)))
  }, [notes.length])

  // Rows are variable height (a long note wraps), so the selection walks out
  // of the viewport without this — the same helper the rail pages use.
  const follow = useCursorFollow(cursor)
  const scrollRef = useRef<ScrollBoxRenderable | null>(null)
  const moveCursor = (delta: number): void => {
    if (notes.length === 0) return
    setCursor((c) => Math.max(0, Math.min(notes.length - 1, c + delta)))
  }

  function requestDelete(): void {
    const note = notes[cursor]
    const remove = props.remove
    // A note with no id predates the id field and no write has stamped it
    // yet; deleting by nothing would delete the wrong row.
    if (!note || !remove || note.id === undefined) return
    const id = note.id
    void DialogConfirm.show(
      dialog,
      t("tasks.fieldNotes.confirmDelete.title"),
      t("tasks.fieldNotes.confirmDelete.body", { text: note.text }),
      undefined,
      undefined,
      { danger: true },
    ).then(async (confirmed) => {
      if (confirmed !== true) return
      // No repaint here. The provider renders ONE dialog, so opening the
      // confirm replaced this reader and by now it is unmounted — whatever
      // shows the result has to be arranged by whoever opened it (`show`).
      await remove(id).catch(() => false)
    })
  }

  // Same keyboard shape as before plus a cursor: navigation keys only, no
  // Rove-owned chord; esc is the DialogProvider's.
  useBindings(() => ({
    bindings: [
      { key: "up", cmd: () => moveCursor(-1) },
      { key: "down", cmd: () => moveCursor(1) },
      { key: "pageup", cmd: () => moveCursor(-(scrollRef.current?.viewport.height ?? 10)) },
      { key: "pagedown", cmd: () => moveCursor(scrollRef.current?.viewport.height ?? 10) },
      ...(props.remove ? [{ key: "d", cmd: () => requestDelete() }] : []),
    ],
  }))

  return (
    <box paddingLeft={padX} paddingRight={padX} gap={1} flexShrink={1}>
      <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <box flexDirection="column" gap={0}>
          <text attributes={TextAttributes.BOLD} fg={theme.text}>
            {t("tasks.fieldNotes.title")}
          </text>
          <text fg={theme.textMuted} wrapMode="none">
            {props.repo}
          </text>
        </box>
        <text fg={theme.textMuted} onMouseUp={props.onClose}>
          esc
        </text>
      </box>
      <scrollbox
        ref={(r: ScrollBoxRenderable | null) => {
          scrollRef.current = r
          return follow.scrollRef(r)
        }}
        flexShrink={1}
        stickyScroll={false}
        verticalScrollbarOptions={{
          trackOptions: { backgroundColor: theme.backgroundDialog, foregroundColor: theme.borderActive },
        }}
      >
        <box gap={1} paddingRight={1}>
          {state.kind === "loading" ? <text fg={theme.textMuted}>{t("tasks.fieldNotes.loading")}</text> : null}
          {state.kind === "error" ? <text fg={theme.error}>{state.message}</text> : null}
          {state.kind === "ready" && notes.length === 0 ? (
            <text fg={theme.textMuted}>{t("tasks.fieldNotes.empty")}</text>
          ) : null}
          {notes.map((note, i) => {
            const selected = i === cursor
            return (
              <box key={`${note.at}:${i}`} gap={0} ref={follow.rowRef(i)} onMouseUp={() => setCursor(i)}>
                <text fg={theme.accent} wrapMode="none">
                  {`${selected ? "▸ " : "  "}${formatAt(note.at)} · ${note.author}`}
                </text>
                <text fg={selected ? theme.text : theme.textMuted}>{`  ${note.text}`}</text>
              </box>
            )
          })}
        </box>
      </scrollbox>
      <box paddingBottom={1} flexShrink={0}>
        <text fg={theme.textMuted}>
          {props.remove ? t("tasks.fieldNotes.footerDeletable") : t("tasks.fieldNotes.footer")}
        </text>
      </box>
    </box>
  )
}

/**
 * Open the reader; resolves when it closes (no value — the delete writes
 * through `remove` as it happens).
 *
 * Takes the ORCHESTRATOR and binds the two store calls here, rather than
 * making every caller pass a matching pair of closures — the same shape
 * `IssueDetailDialog` uses. The VIEW still takes plain callbacks, so it
 * mounts in the render track with no daemon.
 */
function show(dialog: DialogContext, opts: { repo: string; orchestrator: FieldNotesIO }): void {
  const { repo, orchestrator } = opts
  void showDialog<void>(dialog, (resolve) => (
    <FieldNotesDialogView
      repo={repo}
      load={() => orchestrator.listFieldNotes(repo)}
      remove={async (id) => {
        const deleted = await orchestrator.deleteFieldNote(repo, id)
        // Reopen rather than repaint. The confirm REPLACED this reader on the
        // way in (one dialog at a time), so pressing Confirm otherwise
        // retired the note and left nothing on screen to show it gone.
        // Reopening here — after the store call resolved, not racing it —
        // reloads from the store, so the list cannot draw the note back.
        if (deleted) show(dialog, opts)
        return deleted
      }}
      onClose={() => resolve(undefined)}
    />
  ))
}

export const FieldNotesDialog = { show }
