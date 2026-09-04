/**
 * Shared argv flag helpers for CLI subcommands and engine command guards.
 *
 * Both forms of a value flag are one idiom to the user but two token shapes
 * to us: `--flag value` (two tokens) and `--flag=value` (one token).
 * `parseEngineCommand` keeps the attached form as a single token, and so does
 * `process.argv`. A bare `argv.includes("--flag")` / `argv.indexOf("--flag")`
 * therefore misses the attached form silently — the bug class behind double
 * `--session-id` (#361 → #365 → #386) and behind `rove web --port=N` binding
 * the default port with no error (#58). Every flag probe goes through these
 * two; `test/architecture/argv-flag-guards.test.ts` rejects new bare checks.
 */

/** True when `argv` carries `flag` as `--flag` or `--flag=…`. Prefix-safe: `--resume-x` ≠ `--resume`. */
export function argvHasFlag(argv: readonly string[], flag: string): boolean {
  return argv.some((a) => a === flag || a.startsWith(`${flag}=`))
}

/**
 * The value of `flag` from `argv`, accepting `--flag value` and `--flag=value`.
 * `undefined` when the flag is absent OR is the last token with nothing after
 * it — pair with {@link argvHasFlag} to tell those apart.
 */
export function flagValue(argv: readonly string[], flag: string): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === flag) return argv[i + 1]
    if (argv[i].startsWith(`${flag}=`)) return argv[i].slice(flag.length + 1)
  }
  return undefined
}
