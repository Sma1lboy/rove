/** One code row of the diff view, memoised: a cursor move re-renders the rows it touches, not the whole diff. */

import { type MouseEvent, type ReactNode, memo, useMemo, useRef } from "react"
import { DiffNoteLine } from "./diff-row-actions.tsx"
import type { DiffRow } from "./diff.ts"
import { t } from "./i18n/index.ts"
import type { Note } from "./review-notes.ts"
import { DIFF_GUTTER, diffCodeClass, diffRowClass, diffSignClass } from "./ui/diff-row.ts"

export interface RowHandlers {
  rowClick: (index: number, e: MouseEvent) => void
  fileClick: (index: number, path: string | null) => void
  viewedClick: (path: string) => void
  editNote: (note: Note) => void
}

/** This render's handlers behind identities that never change, so the memoised rows skip re-rendering. */
export function useRowHandlers(handlers: RowHandlers): RowHandlers {
  const latest = useRef(handlers)
  latest.current = handlers
  return useMemo(
    () => ({
      rowClick: (i, e) => latest.current.rowClick(i, e),
      fileClick: (i, path) => latest.current.fileClick(i, path),
      viewedClick: (path) => latest.current.viewedClick(path),
      editNote: (note) => latest.current.editNote(note),
    }),
    [],
  )
}

/** A line past this draws clipped: one minified or binary-ish line of megabytes took the browser seconds to lay out. */
const MAX_DRAWN = 2000

export const DiffLine = memo(function DiffLine(props: {
  index: number
  row: DiffRow
  cursor: boolean
  noted: boolean
  /** The floating comment / range / ask buttons, on the selection's last row only. */
  actions: ReactNode
  /** Notes whose range ends on this row. */
  notes: readonly Note[] | undefined
  /** Stable across renders, so an unchanged row skips re-rendering. */
  onClick: (index: number, e: MouseEvent) => void
  onEditNote: (note: Note) => void
}) {
  const { index, row, noted } = props
  return (
    <div>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the view's keys (j/k) move the cursor */}
      <div
        data-row={index}
        className={diffRowClass(row.kind, { cursor: props.cursor, noted })}
        onClick={(e) => props.onClick(index, e)}
      >
        <span className={DIFF_GUTTER}>{row.oldNo ?? ""}</span>
        <span className={DIFF_GUTTER}>{row.newNo ?? ""}</span>
        <span className={diffSignClass(row.kind, noted)}>
          {row.kind === "add" ? "+" : row.kind === "del" ? "−" : noted ? "●" : " "}
        </span>
        <span className={diffCodeClass(row.kind)}>
          {row.text.length > MAX_DRAWN ? row.text.slice(0, MAX_DRAWN) : row.text}
          {row.text.length > MAX_DRAWN && (
            <span className="text-subtle">
              {" "}
              {t("review.lineClipped", { count: (row.text.length - MAX_DRAWN).toLocaleString() })}
            </span>
          )}
        </span>
        {props.actions}
      </div>
      {props.notes?.map((note) => (
        <DiffNoteLine key={note.id} note={note} onEdit={() => props.onEditNote(note)} />
      ))}
    </div>
  )
})
