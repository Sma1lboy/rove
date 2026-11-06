/**
 * The review notes waiting to go to the engine, under a diff: a count that folds the list open, one row
 * per note (where it sits, its text, edit and drop) and one send for all of them as a single prompt.
 */

import { useState } from "react"
import { t, useLocale } from "./i18n/index.ts"
import { type Note, type NoteState, noteLabel } from "./review-notes.ts"
import { Button } from "./ui/button.tsx"
import { Chevron } from "./ui/chevron.tsx"
import { Chip } from "./ui/chip.tsx"

export function ReviewTray({
  notes,
  states,
  sending,
  onShow,
  onEdit,
  onDrop,
  onSend,
}: {
  notes: readonly Note[]
  states: ReadonlyMap<string, NoteState>
  sending: boolean
  onShow: (note: Note) => void
  onEdit: (note: Note) => void
  onDrop: (note: Note) => void
  onSend: () => void
}) {
  useLocale()
  const [open, setOpen] = useState(false)
  if (notes.length === 0) return null
  const count = notes.length
  return (
    <div className="flex max-h-2/5 min-h-0 flex-none flex-col border-t-hairline border-line font-mono text-meta">
      <div className="flex items-center gap-3 px-3 py-1.5 narrow:px-2">
        <Button
          variant="row"
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-ink"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <Chevron right={!open} />
          <span>{count === 1 ? t("review.countOne") : t("review.count", { count })}</span>
        </Button>
        <Button disabled={sending} onClick={onSend}>
          {sending ? t("review.sending") : t("review.send", { count })}
        </Button>
      </div>
      {open && (
        <ul className="m-0 min-h-0 list-none overflow-y-auto p-0 pb-1">
          {notes.map((note) => (
            <li key={note.id} className="flex flex-col gap-0.5 px-3 py-1 narrow:px-2">
              <div className="flex items-baseline gap-2">
                <Button
                  variant="row"
                  className="min-w-0 flex-1 truncate text-left text-ink hover:underline"
                  title={t("review.show")}
                  onClick={() => onShow(note)}
                >
                  {noteLabel(note)}
                </Button>
                {states.get(note.id) === "moved" && (
                  <span title={t("review.movedHint")}>
                    <Chip tone="warning">{t("review.moved")}</Chip>
                  </span>
                )}
                <Button hit="tight" onClick={() => onEdit(note)}>
                  {t("review.edit")}
                </Button>
                <Button hit="tight" onClick={() => onDrop(note)}>
                  {t("review.drop")}
                </Button>
              </div>
              <p className="m-0 line-clamp-2 whitespace-pre-wrap wrap-anywhere text-muted">{note.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
