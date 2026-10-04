/**
 * The one `git status --porcelain` (v1) parser, shared by the TUI (per-file
 * rows) and the daemon's worktree-changes collector (sidebar counts), so the
 * edge-case tests cover the production path.
 *
 * Git C-quotes any name with a space, tab/newline/quote, or non-ASCII byte
 * (`"a\tb.txt"`, `"\303\274.txt"`). Verified against real git:
 *   - Porcelain rename: `XY orig -> new`. Each side is quoted INDEPENDENTLY
 *     (only when it needs quoting); the ` -> ` separator is literal. Porcelain
 *     quotes a path that merely contains a space.
 *   - C-quoting escapes `\a \b \t \n \v \f \r \" \\` and otherwise emits a
 *     three-digit OCTAL escape per BYTE (`\303\274` = the UTF-8 bytes of `ü`),
 *     so octal runs must be decoded as bytes, then UTF-8 decoded.
 *
 * `unquoteGitPath` is shared with kobe's numstat parser (`lib/git-parsers.ts`)
 * so both formats unquote to one path and numstat counts join porcelain rows.
 */

/** One parsed row of `git status --porcelain` (v1). */
export interface PorcelainRow {
  /** Index-side status char (X). May be a space. */
  readonly x: string
  /** Worktree-side status char (Y). May be a space. */
  readonly y: string
  /** Canonical path (post-rename for `R`/`C`), C-unquoted. */
  readonly path: string
  /** Original path for a rename/copy (`R`/`C`), C-unquoted. Absent otherwise. */
  readonly origPath?: string
}

const ENCODER = new TextEncoder()
const DECODER = new TextDecoder()

function isOctalDigit(ch: string): boolean {
  return ch >= "0" && ch <= "7"
}

/**
 * Parse a C-quoted token at `field[start]` (MUST be `"`). `end` is just past
 * the closing quote, or end of input if unterminated.
 */
function readQuoted(field: string, start: number): { value: string; end: number } {
  const bytes: number[] = []
  let lit = ""
  const flush = () => {
    if (lit.length > 0) {
      for (const b of ENCODER.encode(lit)) bytes.push(b)
      lit = ""
    }
  }
  let i = start + 1 // skip opening quote
  while (i < field.length) {
    const ch = field[i] as string
    if (ch === '"') {
      i++ // consume closing quote
      break
    }
    if (ch === "\\") {
      const n = field[i + 1]
      if (n === undefined) {
        // Trailing backslash with nothing after — keep it literal.
        lit += "\\"
        i++
        continue
      }
      switch (n) {
        case "a":
          flush()
          bytes.push(0x07)
          i += 2
          break
        case "b":
          flush()
          bytes.push(0x08)
          i += 2
          break
        case "t":
          flush()
          bytes.push(0x09)
          i += 2
          break
        case "n":
          flush()
          bytes.push(0x0a)
          i += 2
          break
        case "v":
          flush()
          bytes.push(0x0b)
          i += 2
          break
        case "f":
          flush()
          bytes.push(0x0c)
          i += 2
          break
        case "r":
          flush()
          bytes.push(0x0d)
          i += 2
          break
        case '"':
          lit += '"'
          i += 2
          break
        case "\\":
          lit += "\\"
          i += 2
          break
        default:
          if (isOctalDigit(n)) {
            let oct = ""
            let j = i + 1
            while (j < field.length && oct.length < 3 && isOctalDigit(field[j] as string)) {
              oct += field[j]
              j++
            }
            flush()
            bytes.push(Number.parseInt(oct, 8) & 0xff)
            i = j
          } else {
            // Unknown escape — keep the escaped character verbatim.
            lit += n
            i += 2
          }
          break
      }
    } else {
      lit += ch
      i++
    }
  }
  flush()
  return { value: DECODER.decode(new Uint8Array(bytes)), end: i }
}

/** Decode a C-quoted git path; unquoted fields pass through. Never throws. */
export function unquoteGitPath(field: string): string {
  if (field.length === 0 || field[0] !== '"') return field
  return readQuoted(field, 0).value
}

/** Split `orig -> new` (each side quoted independently); `null` if no separator. */
function splitRenameField(field: string, sep: string): { orig: string; neu: string } | null {
  if (field[0] === '"') {
    const left = readQuoted(field, 0)
    if (field.startsWith(sep, left.end)) {
      return { orig: left.value, neu: unquoteGitPath(field.slice(left.end + sep.length)) }
    }
    return null
  }
  const idx = field.indexOf(sep)
  if (idx < 0) return null
  return { orig: field.slice(0, idx), neu: unquoteGitPath(field.slice(idx + sep.length)) }
}

/**
 * Lenient: every `XY <path>` line is returned; `##` headers, blank and short
 * lines are skipped. Status filtering is the consumer's job (the sidebar
 * counts everything; the file tree filters).
 */
export function parsePorcelainRows(raw: string): PorcelainRow[] {
  const rows: PorcelainRow[] = []
  for (const rawLine of raw.split("\n")) {
    const line = rawLine.replace(/\r$/, "")
    if (line.length < 4) continue // need at least "XY p"
    if (line.startsWith("##")) continue // branch header (`--branch`)
    const x = line[0] as string
    const y = line[1] as string
    if (line[2] !== " ") continue
    const rest = line.slice(3)
    if (x === "R" || x === "C" || y === "R" || y === "C") {
      const split = splitRenameField(rest, " -> ")
      if (split) {
        rows.push({ x, y, path: split.neu, origPath: split.orig })
        continue
      }
    }
    rows.push({ x, y, path: unquoteGitPath(rest) })
  }
  return rows
}
