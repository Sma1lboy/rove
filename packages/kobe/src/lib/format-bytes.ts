/**
 * The one byte formatter. Every "N KB / N MB" string in the kobe package
 * renders through here — the promote-then-round dance below is exactly the
 * logic that drifted into buggy per-file copies before (doctor's old
 * `fmtBytes` compared the raw value against the threshold *before* rounding,
 * so sizes just under a boundary rendered as "1024.0 KB").
 */

/** `1.2 KB` / `340 B` / `12 MB` — human-readable byte size. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ["KB", "MB", "GB", "TB"]
  let v = n / 1024
  let i = 0
  // Promote at 1023.5, not 1024: once v rounds up to 1024 it would render as
  // "1024 KB" instead of "1.0 MB" at the unit boundary (Math.round rounds .5 up).
  while (v >= 1023.5 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}
