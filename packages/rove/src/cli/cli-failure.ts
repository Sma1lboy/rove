/**
 * How an uncaught subcommand failure is spelled to the user — the top-level
 * `main().catch()` covers EVERY subcommand.
 *
 * - **Name the command, not the process** (`rove adopt: …`), matching the
 *   prefix self-handling subcommands already print. A "failed to start" prefix
 *   would be false for nearly all of them.
 * - **Boil a raw git invocation down to a sentence** ending in an action; the
 *   argv/cwd/exit code `runGit` throws are not actionable. CLI counterpart of
 *   the TUI's {@link summarizeGitError}.
 *
 * Unrecognized messages pass through verbatim: swallowing an error we don't
 * understand is worse than a noisy one.
 */

import { errorMessage } from "@/lib/error-message"

/** `KOBE_DEBUG=1` keeps the raw throw (stack included) for bug reports. */
function debugEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.KOBE_DEBUG === "1" || env.ROVE_DEBUG === "1"
}

/** `rove adopt` when argv named a subcommand, plain `rove` otherwise (the bare TUI launch). */
export function failureSubject(cliName: string, argv: readonly string[]): string {
  const verb = argv[2]
  // Flags and paths (`rove --help`, `rove ~/repo`) are not subcommands.
  return verb && !verb.startsWith("-") && !verb.includes("/") ? `${cliName} ${verb}` : cliName
}

/**
 * A user-facing sentence for a raw git failure, or null. Only not-a-repository
 * is mapped: running in the wrong directory, fixed by a directory change.
 */
export function summarizeCliGitError(message: string, cwd: string): string | null {
  if (!/not a git repository/i.test(message)) return null
  return `${cwd} is not a git repository — run this inside one, or pass a repo path.`
}

/** The single line the top-level catch prints. Never throws. */
export function formatCliFailure(
  err: unknown,
  opts: { cliName: string; argv: readonly string[]; cwd: string; env: NodeJS.ProcessEnv },
): string {
  const subject = failureSubject(opts.cliName, opts.argv)
  if (debugEnabled(opts.env)) return `${subject}: ${String(err instanceof Error ? (err.stack ?? err) : err)}`
  const raw = errorMessage(err)
  return `${subject}: ${summarizeCliGitError(raw, opts.cwd) ?? raw}`
}
