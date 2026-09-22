/** The one byte formatter; the promote-then-round logic is easy to get wrong in copies. */

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
  // Branch on the printed value: v in [99.95, 100) would print "100.0". The
  // integer still rounds raw v once (no double rounding of 1023.499 → 1024).
  const oneDecimal = v.toFixed(1)
  return `${Number(oneDecimal) >= 100 ? Math.round(v) : oneDecimal} ${units[i]}`
}
