/**
 * Shell command quoting helpers.
 *
 * Use these whenever argv values must be flattened back into a single shell
 * command string. The default is conservative (quote every argument); callers
 * that need readable launch lines can allow a small safe bare-token set.
 */

const SAFE_BARE_TOKEN = /^[A-Za-z0-9_/.:=-]+$/

export interface QuoteShellArgvOptions {
  /**
   * Leave simple argv tokens unquoted. This keeps generated launch lines easier
   * to read while still quoting spaces, quotes, and shell metacharacters.
   */
  readonly bareSafe?: boolean
  /**
   * Quote for a Windows shell (cmd.exe / PowerShell) instead of POSIX sh: a
   * token that needs quoting gets double quotes, with inner quotes
   * backslash-escaped. A POSIX single-quoted token is not a quote there at
   * all — cmd runs `'kobe'` as a program named `'kobe'` and PowerShell reads
   * it as a string expression — so a command persisted for a Windows host
   * (codex hooks) must never carry single quotes. Bare tokens are the
   * portable subset and need no dialect.
   */
  readonly windows?: boolean
}

/** Quote one value as a POSIX single-quoted shell token. */
export function quoteShellArg(value: string, opts: QuoteShellArgvOptions = {}): string {
  if (opts.bareSafe && SAFE_BARE_TOKEN.test(value)) return value
  if (opts.windows) return quoteWindowsArg(value)
  return `'${value.replace(/'/g, "'\\''")}'`
}

/**
 * MSVCRT argv quoting: wrap in double quotes; a quote inside is escaped and
 * the backslashes immediately before it (or before the closing quote) are
 * doubled. Every other backslash — the ones in a path — stays as it is, which
 * is what cmd.exe and PowerShell both hand through unchanged.
 */
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

/** Quote argv values and join them into one shell command line. */
export function quoteShellArgv(argv: readonly string[], opts: QuoteShellArgvOptions = {}): string {
  return argv.map((arg) => quoteShellArg(arg, opts)).join(" ")
}
