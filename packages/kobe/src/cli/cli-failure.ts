/**
 * How an uncaught subcommand failure is spelled to the user.
 *
 * The top-level `main().catch()` is the fallback for EVERY subcommand, so
 * whatever it prints is what a user sees for `adopt`, `add`, `export`, `land`
 * and the rest. Two rules follow from that:
 *
 * - **Name the command that failed, not the process.** A fixed "failed to
 *   start" prefix is false for every subcommand that started fine and then
 *   failed doing its job, which is nearly all of them. `rove adopt: …` also
 *   matches the prefix the subcommands that DO handle their own errors
 *   already print (`rove add: …`, `rove remove: …`).
 * - **Boil a raw git invocation down to a sentence.** `runGit` throws
 *   `git worktree list --porcelain (cwd=/private/tmp) exited with code 128:
 *   fatal: not a git repository …` — the argv, the cwd and the exit code are
 *   debugging detail the user did not ask for and cannot act on. The TUI's
 *   file tree solved this already ({@link summarizeGitError}); this is the
 *   CLI's half, and unlike the TUI's short labels it ends in an action,
 *   because a CLI user has a shell in front of them.
 *
 * Unrecognized messages pass through verbatim: a boil-down that swallows an
 * error it does not understand is worse than a noisy one.
 */

import { errorMessage } from "@/lib/error-message"

/** `KOBE_DEBUG=1` keeps the raw throw (stack included) for bug reports. */
function debugEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.KOBE_DEBUG === "1" || env.ROVE_DEBUG === "1"
}

/**
 * The subject a failure is attributed to: `rove adopt` when argv named a
 * subcommand, plain `rove` when it did not (the bare TUI launch, which really
 * can fail at startup).
 */
export function failureSubject(cliName: string, argv: readonly string[]): string {
  const verb = argv[2]
  // Flags and paths are not subcommands — `rove --help` / `rove ~/repo` land
  // in the TUI/open-directory paths, so attributing to `rove` is the truth.
  return verb && !verb.startsWith("-") && !verb.includes("/") ? `${cliName} ${verb}` : cliName
}

/**
 * A user-facing sentence for a raw git failure, or null when the shape is not
 * one we can say anything better about.
 *
 * Only the not-a-repository case is mapped: it is the one a user hits by
 * running a Rove command in the wrong directory, and the remedy is a
 * directory change rather than anything about git.
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
