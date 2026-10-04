/** Flatten argv into one shell command string; quotes every argument by default. */

const SAFE_BARE_TOKEN = /^[A-Za-z0-9_/.:=-]+$/

export interface QuoteShellArgvOptions {
  /** Leave tokens matching a small safe set unquoted, for readable launch lines. */
  readonly bareSafe?: boolean
  /**
   * Double-quote for cmd.exe / PowerShell. Single quotes are not quotes there
   * (cmd runs `'kobe'` as a program named `'kobe'`), so a command persisted for
   * a Windows host (codex hooks) must never carry them.
   */
  readonly windows?: boolean
}

/** POSIX single-quoted token by default; see {@link QuoteShellArgvOptions}. */
export function quoteShellArg(value: string, opts: QuoteShellArgvOptions = {}): string {
  if (opts.bareSafe && SAFE_BARE_TOKEN.test(value)) return value
  if (opts.windows) return quoteWindowsArg(value)
  return `'${value.replace(/'/g, "'\\''")}'`
}

/** MSVCRT argv quoting: backslashes are doubled only before a `"` (inner or
 *  closing); path backslashes stay as-is. */
function quoteWindowsArg(value: string): string {
  let out = '"'
  let backslashes = 0
  for (const ch of value) {
    if (ch === "\\") {
      backslashes++
      continue
    }
    if (ch === '"') {
      out += `${"\\".repeat(backslashes * 2 + 1)}"`
      backslashes = 0
      continue
    }
    out += "\\".repeat(backslashes) + ch
    backslashes = 0
  }
  return `${out}${"\\".repeat(backslashes * 2)}"`
}

export function quoteShellArgv(argv: readonly string[], opts: QuoteShellArgvOptions = {}): string {
  return argv.map((arg) => quoteShellArg(arg, opts)).join(" ")
}
