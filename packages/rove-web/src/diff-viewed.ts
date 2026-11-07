/**
 * Per-file "viewed" marks for the diff view. A mark is kept per task + file and
 * remembers a hash of the file's diff rows, so it holds only while the file
 * reads the same: change the file and the mark is gone.
 */

import type { DiffRow } from "./diff.ts"

const KEY = "rove.diffViewed"

/** task id + file → hash of the file's diff when it was marked. */
export type ViewedMarks = Readonly<Record<string, string>>

const markKey = (taskId: string, path: string): string => `${taskId}\0${path}`

/** Past this a line hashes by its ends and length: walking a minified or binary-ish line of megabytes took seconds. */
const LONG_LINE = 4096

/** FNV-1a over `kind` + text + `\n` of each row: cheap, and a change to any line changes it (bar the middle of a huge one). */
function hashRows(rows: readonly DiffRow[]): string {
  let h = 0x811c9dc5
  for (const row of rows) {
    const text =
      row.text.length > LONG_LINE
        ? `${row.text.slice(0, LONG_LINE / 2)}${row.text.length}${row.text.slice(-LONG_LINE / 2)}`
        : row.text
    const s = `${row.kind}${text}\n`
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  }
  return (h >>> 0).toString(16)
}

/** Each file's hash, keyed by path (a file's rows run from its header to the next one). */
export function fileHashes(rows: readonly DiffRow[]): Map<string, string> {
  const out = new Map<string, string>()
  let from = -1
  const close = (to: number) => {
    const path = from >= 0 ? rows[from]?.path : null
    if (path) out.set(path, hashRows(rows.slice(from + 1, to)))
  }
  rows.forEach((row, i) => {
    if (row.kind !== "file") return
    close(i)
    from = i
  })
  close(rows.length)
  return out
}

export function loadMarks(): ViewedMarks {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}")
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {}
    return Object.fromEntries(Object.entries(saved).filter((e): e is [string, string] => typeof e[1] === "string"))
  } catch {
    return {}
  }
}

export function saveMarks(marks: ViewedMarks): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(marks))
  } catch {
    // Storage off: the marks last this page only.
  }
}

/** The files of `hashes` whose mark still matches. */
export function viewedFiles(marks: ViewedMarks, taskId: string, hashes: ReadonlyMap<string, string>): Set<string> {
  const out = new Set<string>()
  for (const [path, hash] of hashes) if (marks[markKey(taskId, path)] === hash) out.add(path)
  return out
}

export function withMark(marks: ViewedMarks, taskId: string, path: string, hash: string | undefined): ViewedMarks {
  const next = { ...marks }
  if (hash === undefined) delete next[markKey(taskId, path)]
  else next[markKey(taskId, path)] = hash
  return next
}

/** The next index after `from` in `sorted` (ascending), wrapping to the first; null when empty. */
export function nextAfter(sorted: readonly number[], from: number): number | null {
  return sorted.find((n) => n > from) ?? sorted[0] ?? null
}

const WS_KEY = "rove.diffIgnoreWs"

/** The hide-whitespace toggle, kept per browser. */
export function loadIgnoreWs(): boolean {
  try {
    return localStorage.getItem(WS_KEY) === "1"
  } catch {
    return false
  }
}

export function saveIgnoreWs(on: boolean): void {
  try {
    localStorage.setItem(WS_KEY, on ? "1" : "0")
  } catch {
    // Storage off: the toggle lasts this page only.
  }
}
