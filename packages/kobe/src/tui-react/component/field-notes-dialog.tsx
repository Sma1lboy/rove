/** @jsxImportSource @opentui/react */
/**
 * Field-notes reader — the project row menu's "Field notes" entry. Agents file
 * durable repo-level gotchas with `rove api note`; every fresh worktree
 * session is seeded with the newest of them (`state/field-notes.ts`), but
 * until this dialog a human could only read the store from a shell
 * (`rove api note-list`).
 *
 * Read-only by design: the daemon is the store's only writer, and a note is a
 * conclusion some session already paid for. Each row carries the note's
 * author and time because provenance is the point — the reader's next move
 * is usually opening the session that filed it.
 *
 * Reads through the daemon's `note.list` RPC rather than the launch-path
 * reader so the dialog shows what the store holds (50 retained) instead of
 * the 15-note injection cap.
 */

import { TextAttributes } from "@opentui/core"
import type { ScrollBoxRenderable } from "@opentui/core"
import { useEffect, useRef, useState } from "react"
import type { StoredFieldNote } from "../../state/field-notes"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import { useBindings } from "../lib/keymap"
import { type DialogContext, showDialog, useDialogPaddingX } from "../ui/dialog"

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
  onClose: () => void
}) {
  const { theme } = useTheme()
  const t = useT()
  const padX = useDialogPaddingX()
  const [state, setState] = useState<LoadState>({ kind: "loading" })

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

  // Same keyboard-scroll shape as the help dialog: native navigation keys
  // only, no Rove-owned chord; esc is the DialogProvider's.
  const scrollRef = useRef<ScrollBoxRenderable | null>(null)
  const scrollBy = (lines: number): void => {
    const scroll = scrollRef.current
    if (!scroll) return
    scroll.scrollTo({ x: 0, y: Math.max(0, scroll.scrollTop + lines) })
  }
  useBindings(() => ({
    bindings: [
      { key: "up", cmd: () => scrollBy(-1) },
      { key: "down", cmd: () => scrollBy(1) },
      { key: "pageup", cmd: () => scrollBy(-(scrollRef.current?.viewport.height ?? 10)) },
      { key: "pagedown", cmd: () => scrollBy(scrollRef.current?.viewport.height ?? 10) },
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
          {state.kind === "ready" && state.notes.length === 0 ? (
            <text fg={theme.textMuted}>{t("tasks.fieldNotes.empty")}</text>
          ) : null}
          {state.kind === "ready"
            ? state.notes.map((note, i) => (
                <box key={`${note.at}:${i}`} gap={0}>
                  <text fg={theme.accent} wrapMode="none">
                    {`${formatAt(note.at)} · ${note.author}`}
                  </text>
                  <text fg={theme.text}>{note.text}</text>
                </box>
              ))
            : null}
        </box>
      </scrollbox>
      <box paddingBottom={1} flexShrink={0}>
        <text fg={theme.textMuted}>{t("tasks.fieldNotes.footer")}</text>
      </box>
    </box>
  )
}

/** Open the reader; resolves when it closes (no value — it is read-only). */
function show(dialog: DialogContext, opts: { repo: string; load: () => Promise<readonly StoredFieldNote[]> }): void {
  void showDialog<void>(dialog, (resolve) => (
    <FieldNotesDialogView repo={opts.repo} load={opts.load} onClose={() => resolve(undefined)} />
  ))
}

export const FieldNotesDialog = { show }
