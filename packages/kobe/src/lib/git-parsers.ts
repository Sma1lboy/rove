/**
 * Shared parser for `git status --porcelain` and `git diff --numstat -z`,
 * with C-string unquoting.
 *
 * Git emits a filename with a space (porcelain only), tab/newline/quote, or
 * non-ASCII byte as a double-quoted C-escaped string (`"a\tb.txt"`,
 * `"\303\274.txt"`). Unquoting BOTH sides to one canonical path is what lets
 * numstat counts join their porcelain row: porcelain quotes `"a b.txt"`,
 * numstat does not.
 *
 * Exposes typed ROWS (raw `XY` pair + canonical post-rename path); consumers
 * derive their own per-file or aggregate views.
 *
 * Quoting/rename facts this parser encodes (verified against real git):
 *   - Porcelain rename: `XY orig -> new`. Each side is quoted INDEPENDENTLY
 *     (only when it needs quoting); the ` -> ` separator is literal. Porcelain
 *     quotes a path that merely contains a space.
 *   - Numstat rename (with `-z`): records are NUL-delimited, so git emits the
 *     old and new paths as separate raw fields. There is no brace-compaction
 *     and no ` => ` separator to parse, which avoids an inherent ambiguity
 *     when a path itself contains a literal `{`.
 *   - C-quoting escapes `\a \b \t \n \v \f \r \" \\` and otherwise emits a
 *     three-digit OCTAL escape per BYTE (`\303\274` = the UTF-8 bytes of `ü`),
 *     so octal runs must be decoded as bytes, then UTF-8 decoded.
 */

/** The porcelain half lives in the daemon package so both share one parser. */
export { parsePorcelainRows, unquoteGitPath } from "@sma1lboy/kobe-daemon/daemon/git-porcelain"
import { unquoteGitPath } from "@sma1lboy/kobe-daemon/daemon/git-porcelain"

/** One parsed row of `git diff --numstat`. */
export interface NumstatRow {
  /** Canonical path (post-rename), C-unquoted. */
  readonly path: string
  /** Original path for a rename, C-unquoted. Absent otherwise. */
  readonly origPath?: string
  /** Lines added. `null` for a binary file (git emits `-`). */
  readonly added: number | null
  /** Lines deleted. `null` for a binary file (git emits `-`). */
  readonly deleted: number | null
}

function parseCount(token: string): number | null {
  if (token === "-") return null
  const n = Number.parseInt(token, 10)
  return Number.isNaN(n) ? null : n
}

/**
 * Parse the raw stdout of `git diff --numstat -z` into typed rows. Records
 * are NUL-delimited:
 *   - non-rename: `<added>\t<deleted>\t<path>\0`
 *   - rename:     `<added>\t<deleted>\t\0<old>\0<new>\0`
 *
 * Binary counts are `-` (→ `null`). `-z` paths are raw, so `unquoteGitPath`
 * is a defensive no-op. Malformed fields are skipped.
 */
export function parseNumstatRows(raw: string): NumstatRow[] {
  const rows: NumstatRow[] = []
  const fields = raw.split("\0")
  // Real `-z` output ends with a trailing NUL, producing an empty final field.
  if (fields.length > 0 && fields[fields.length - 1] === "") {
    fields.pop()
  }
  let i = 0
  while (i < fields.length) {
    const header = fields[i] as string
    const tab1 = header.indexOf("\t")
    if (tab1 < 0) {
      i++
      continue
    }
    const tab2 = header.indexOf("\t", tab1 + 1)
    if (tab2 < 0) {
      i++
      continue
    }
    const added = parseCount(header.slice(0, tab1))
    const deleted = parseCount(header.slice(tab1 + 1, tab2))
    const pathField = header.slice(tab2 + 1)
    if (pathField.length > 0) {
      // Non-rename: the path is the third field.
      rows.push({ path: unquoteGitPath(pathField), added, deleted })
      i++
    } else {
      // Rename: the next two fields are the source and destination paths.
      if (i + 2 >= fields.length) break
      rows.push({
        path: unquoteGitPath(fields[i + 2] as string),
        origPath: unquoteGitPath(fields[i + 1] as string),
        added,
        deleted,
      })
      i += 3
    }
  }
  return rows
}
