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

/** `true/1/yes` → true, `false/0/no` → false, anything else → undefined. */
export function parseBoolLiteral(raw: string): boolean | undefined {
  if (["true", "1", "yes"].includes(raw)) return true
  if (["false", "0", "no"].includes(raw)) return false
  return undefined
}

/**
 * An on/off switch: absent → false, bare `--flag` → true, `--flag=<bool>` →
 * that literal. `undefined` for any other inline value, so a typo or
 * `--flag=false` can never turn the switch ON.
 */
export function switchFlag(argv: readonly string[], flag: string): boolean | undefined {
  let on = false
  for (const a of argv) {
    if (a === flag) on = true
    else if (a.startsWith(`${flag}=`)) {
      const value = parseBoolLiteral(a.slice(flag.length + 1))
      if (value === undefined) return undefined
      on = value
    }
  }
  return on
}
