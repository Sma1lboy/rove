/**
 * Unified diff → display rows with gutter numbers. A review note anchors to
 * the gutter number the row shows (new-file for added/context rows, old-file
 * for removed), the TUI's `DiffComment.line` contract (`tui/ops/diff-comments.ts`).
 */

export type DiffRowKind = "file" | "hunk" | "add" | "del" | "ctx" | "meta"

export interface DiffRow {
  readonly kind: DiffRowKind
  readonly text: string
  readonly oldNo: number | null
  readonly newNo: number | null
  /** The file this row belongs to (combined diffs carry several). */
  readonly path: string | null
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

export function parseUnifiedDiff(text: string, fallbackPath: string | null = null): DiffRow[] {
  const rows: DiffRow[] = []
  let oldNo = 0
  let newNo = 0
  let path = fallbackPath
  let inHunk = false
  for (const line of text.replace(/\n$/, "").split("\n")) {
    if (line.startsWith("diff --git ")) {
      const m = / b\/(.+)$/.exec(line)
      path = m ? m[1] : path
      inHunk = false
      rows.push({ kind: "file", text: path ?? line, oldNo: null, newNo: null, path })
      continue
    }
    const hunk = HUNK.exec(line)
    if (hunk) {
      oldNo = Number(hunk[1])
      newNo = Number(hunk[2])
      inHunk = true
      rows.push({ kind: "hunk", text: line, oldNo: null, newNo: null, path })
      continue
    }
    if (!inHunk) {
      // index / --- / +++ / mode lines: shown dim, never anchored.
      rows.push({ kind: "meta", text: line, oldNo: null, newNo: null, path })
      continue
    }
    if (line.startsWith("+")) rows.push({ kind: "add", text: line.slice(1), oldNo: null, newNo: newNo++, path })
    else if (line.startsWith("-")) rows.push({ kind: "del", text: line.slice(1), oldNo: oldNo++, newNo: null, path })
    else if (line.startsWith("\\")) rows.push({ kind: "meta", text: line, oldNo: null, newNo: null, path })
    else rows.push({ kind: "ctx", text: line.slice(1), oldNo: oldNo++, newNo: newNo++, path })
  }
  return rows
}

/** Plain file content as rows, numbered like a diff's new side. */
export function codeRows(text: string, path: string): DiffRow[] {
  return text
    .replace(/\n$/, "")
    .split("\n")
    .map((line, i) => ({ kind: "ctx", text: line, oldNo: null, newNo: i + 1, path }))
}

/** The number a note on this row anchors to; null on rows a note can't sit on. */
export function displayLine(row: DiffRow): number | null {
  return row.kind === "del" ? row.oldNo : row.kind === "add" || row.kind === "ctx" ? row.newNo : null
}

/** `v` anchor + cursor → the note's range, like the TUI's `commentRange`. */
export function noteRange(
  rows: readonly DiffRow[],
  cursor: number,
  anchor: number | null,
): { path: string; line: number; startLine?: number } | null {
  const at = rows[cursor]
  const line = at ? displayLine(at) : null
  if (!at?.path || line === null) return null
  if (anchor === null || anchor === cursor) return { path: at.path, line }
  const from = rows[Math.min(anchor, cursor)]
  const to = rows[Math.max(anchor, cursor)]
  const start = from ? displayLine(from) : null
  const end = to ? displayLine(to) : null
  if (start === null || end === null || from?.path !== to?.path) return { path: at.path, line }
  return start === end
    ? { path: at.path, line: end }
    : { path: at.path, startLine: Math.min(start, end), line: Math.max(start, end) }
}
