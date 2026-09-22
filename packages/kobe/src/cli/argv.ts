/**
 * Every flag probe goes through these: a bare `argv.includes("--flag")`
 * silently misses the one-token `--flag=value` form (e.g. a double
 * `--session-id`, or `--port=N` binding the default port).
 * `test/architecture/argv-flag-guards.test.ts` rejects new bare checks.
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
