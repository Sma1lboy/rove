/** @jsxImportSource @opentui/react */
/**
 * Field-notes reader (project row menu). Agents file repo gotchas with
 * `rove api note`; the newest 15 seed every fresh worktree session
 * (`state/field-notes.ts`), so a stale note misleads later agents.
 *
 * Read plus RETIRE (`d`); no edit — a changed fact is a new note. Rows show
 * author and time because the next move is usually opening that session.
 * The daemon stays the store's only writer.
 *
 * PROPOSED CHORD, pending owner sign-off (docs/KEYBINDINGS.md): `d` deletes
 * the selected note, matching the kanban board's and tasks pane's `d`. It
 * shadows nothing: this dialog binds only navigation keys and has no input.
 *
 * Reads the `note.list` RPC, not the launch-path reader, to show the whole
 * store (50) rather than the 15-note injection cap.
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

/** The two store calls {@link show} binds, instead of the whole orchestrator. */
interface FieldNotesIO {
  listFieldNotes(repo: string): Promise<readonly StoredFieldNote[]>
  deleteFieldNote(repo: string, id: number): Promise<boolean>
}

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly notes: readonly StoredFieldNote[] }
  | { readonly kind: "error"; readonly message: string }

/** ISO `at` → local time to the minute; unparseable → the raw string, not "Invalid Date". */
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
  // Re-clamp on row-count change so a tail delete can't strand the cursor.
  useEffect(() => {
    setCursor((c) => Math.max(0, Math.min(c, notes.length - 1)))
  }, [notes.length])

  // Rows wrap to variable height, so keep the selection in view.
  const follow = useCursorFollow(cursor)
  const scrollRef = useRef<ScrollBoxRenderable | null>(null)
  const moveCursor = (delta: number): void => {
    if (notes.length === 0) return
    setCursor((c) => Math.max(0, Math.min(notes.length - 1, c + delta)))
  }

  function requestDelete(): void {
    const note = notes[cursor]
    const remove = props.remove
    // An id-less (legacy, unstamped) note can't be deleted safely.
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
      // No repaint: the confirm replaced (unmounted) this reader; `show` reopens it.
      await remove(id).catch(() => false)
    })
  }

  // Navigation keys only; esc is the DialogProvider's.
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
 * Open the reader; resolves on close (deletes write through `remove` live).
 * Binds the store calls from the orchestrator here; the VIEW takes plain
 * callbacks so it mounts in the render track with no daemon.
 */
function show(dialog: DialogContext, opts: { repo: string; orchestrator: FieldNotesIO }): void {
  const { repo, orchestrator } = opts
  void showDialog<void>(dialog, (resolve) => (
    <FieldNotesDialogView
      repo={repo}
      load={() => orchestrator.listFieldNotes(repo)}
      remove={async (id) => {
        const deleted = await orchestrator.deleteFieldNote(repo, id)
        // Reopen: the confirm REPLACED the reader. Doing it after the store
        // call resolves reloads fresh, so the note can't be drawn back.
        if (deleted) show(dialog, opts)
        return deleted
      }}
      onClose={() => resolve(undefined)}
    />
  ))
}

export const FieldNotesDialog = { show }
