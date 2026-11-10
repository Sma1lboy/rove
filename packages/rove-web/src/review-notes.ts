/**
 * Review notes against the rows on screen: the code a note quotes, and where (or whether) that code still
 * sits. A note stores the rows it covered as the reviewer saw them (`code`); a later diff that no longer
 * shows the same rows at that place marks the note `moved`.
 */

import { type DiffRow, displayLine } from "./diff.ts"

export interface Note {
  readonly id: string
  readonly filePath: string
  readonly startLine?: number
  readonly line: number
  readonly body: string
  readonly code?: string
  readonly sentAt?: number
}

export type NoteState = "ok" | "moved" | "unknown"

const SIGN: Partial<Record<string, string>> = { add: "+", del: "-" }
const MAX_QUOTE_ROWS = 40
const MAX_QUOTE_WIDTH = 160

const encode = (row: DiffRow): string => `${SIGN[row.kind] ?? " "}${row.text.slice(0, MAX_QUOTE_WIDTH)}`

/** `path:12` or `path:12-14`. */
export const noteLabel = (n: Pick<Note, "filePath" | "startLine" | "line">): string =>
  n.startLine !== undefined && n.startLine !== n.line
    ? `${n.filePath}:${n.startLine}-${n.line}`
    : `${n.filePath}:${n.line}`

/** The rows from `first` to `last` that a note can sit on, as the quoted code: sign then text, one per line. */
export function quoteRows(rows: readonly DiffRow[], first: number, last: number): string {
  const lines: string[] = []
  for (let i = first; i <= last && lines.length < MAX_QUOTE_ROWS; i++) {
    const row = rows[i]
    if (row && displayLine(row) !== null) lines.push(encode(row))
  }
  return lines.join("\n")
}

/** The row indexes a note covers in `rows` (first..last), or null when its code is not there. */
export function locate(note: Note, rows: readonly DiffRow[]): { first: number; last: number } | null {
  const start = note.startLine ?? note.line
  const sits = rows.flatMap((row, i) => (row.path === note.filePath && displayLine(row) !== null ? [i] : []))
  if (!note.code) {
    const hit = sits.filter((i) => {
      const line = displayLine(rows[i] as DiffRow) as number
      return line >= start && line <= note.line
    })
    const first = hit[0]
    const last = hit[hit.length - 1]
    return first === undefined || last === undefined ? null : { first, last }
  }
  const quoted = note.code.split("\n")
  for (let k = 0; k + quoted.length <= sits.length; k++) {
    const at = sits.slice(k, k + quoted.length)
    const first = at[0]
    const last = at[at.length - 1]
    if (first === undefined || last === undefined) continue
    if (displayLine(rows[first] as DiffRow) !== start) continue
    if (at.every((i, j) => encode(rows[i] as DiffRow) === quoted[j])) return { first, last }
  }
  return null
}

/**
 * Whether a note still sits where it was written. `whole`: `rows` are every changed file, loaded, so a file
 * absent from them has no change left; a single-file view says nothing about other files' notes.
 */
export function noteState(note: Note, rows: readonly DiffRow[], whole: boolean): NoteState {
  if (locate(note, rows)) return "ok"
  const hasFile = rows.some((row) => row.path === note.filePath)
  return hasFile || whole ? "moved" : "unknown"
}
