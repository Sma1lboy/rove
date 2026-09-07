/**
 * One rigorous, shared parser for `git status --porcelain` and
 * `git diff --numstat -z` output, with correct C-string unquoting.
 *
 * Why this module exists: the file-tree pane (`tui/panes/filetree/git.ts`)
 * and the sidebar's per-row change chip (`tui/panes/sidebar/worktree-changes.ts`)
 * both parsed the SAME two git formats, with different rigor and neither
 * unquoting paths. Git emits any filename containing a space (porcelain
 * renames), a tab/newline/quote, or a non-ASCII byte as a double-quoted,
 * C-escaped string (e.g. `"a\tb.txt"`, `"\303\274.txt"`). Without unquoting:
 *   - those files render with the wrong (still-escaped) path, and
 *   - a renamed-or-modified file whose name has a space loses its +/- line
 *     counts, because porcelain quotes the path (`"a b.txt"`) while numstat
 *     does NOT (`a b.txt`), so the two never key-match on join.
 * Unquoting BOTH sides to one canonical path is exactly what makes the
 * numstat counts join their porcelain status row.
 *
 * The two consumers want different shapes (the file tree wants per-file
 * rows, the sidebar wants aggregate +/- counts), so this module exposes the
 * lowest common denominator: typed ROWS that preserve the raw `XY` status
 * pair and the canonical (post-rename, unquoted) path. Each consumer derives
 * its own headline/aggregate from those rows.
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

/**
 * The porcelain half of this module now lives in
 * `@sma1lboy/kobe-daemon/daemon/git-porcelain` — the daemon's worktree-changes
 * collector parses the same format and had grown its own, laxer copy. Both
 * consumers import the one parser; this re-export keeps kobe's callers (and
 * `test/lib/git-parsers.test.ts`) addressing it here.
 */
export { type PorcelainRow, parsePorcelainRows, unquoteGitPath } from "@sma1lboy/kobe-daemon/daemon/git-porcelain"
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
 * Binary files use `-` for the counts (→ `null`). Paths are unquoted so the
 * counts key by the same canonical path the porcelain `R` row reports. With
 * `-z`, git emits raw paths (no C-quoting), but `unquoteGitPath` is kept as a
 * harmless no-op for extra robustness. Blank / malformed fields are skipped.
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
