/** What hangs off a diff row: the floating comment / range / ask buttons, and a note's inline line. */

import { t } from "./i18n/index.ts"
import type { Note } from "./review-notes.ts"
import { Button } from "./ui/button.tsx"
import { DIFF_NOTE_TEXT, diffRowClass } from "./ui/diff-row.ts"

export function DiffRowActions(props: {
  /** A phone offers "range" until one is started. */
  showRange: boolean
  /** A range is selected: it can be asked about in chat. */
  ranged: boolean
  onComment: () => void
  onRange: () => void
  onAsk: () => void
}) {
  return (
    <div className="absolute top-full right-3 z-1 flex gap-1.5">
      <Button
        variant="floating"
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          e.stopPropagation()
          props.onComment()
        }}
      >
        {t("review.comment")}
      </Button>
      {props.showRange && (
        <Button
          variant="floating"
          onClick={(e) => {
            e.stopPropagation()
            props.onRange()
          }}
        >
          {t("review.range")}
        </Button>
      )}
      {props.ranged && (
        <Button
          variant="floating"
          title={t("preview.askInChatHint")}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation()
            props.onAsk()
          }}
        >
          {t("preview.askInChat")}
        </Button>
      )}
    </div>
  )
}

export function DiffNoteLine({ note, onEdit }: { note: Note; onEdit: () => void }) {
  return (
    <Button
      variant="row"
      className={`${diffRowClass("note", { cursor: false, noted: false })} w-full text-left`}
      onClick={onEdit}
    >
      <span />
      <span />
      <span className="text-accent">●</span>
      <span className={DIFF_NOTE_TEXT}>{note.body}</span>
    </Button>
  )
}
