/**
 * The shared vocabulary of the process probe: one row of the process table,
 * the way rows are written back out, and the error that means "I could not
 * look" as opposed to "I looked and found nothing".
 *
 * Its own module because the probe has two sources — POSIX `ps` in
 * `foreground.ts` and the Windows CIM/ConPTY walk in
 * `win-process-snapshot.ts` — and both need this vocabulary. Putting it in
 * either one would make the pair import each other.
 */

/** One line of `ps -A -o pid=,ppid=,args=`, or its Windows equivalent. */
export type ProcRow = {
  readonly pid: number
  readonly ppid: number
  /** Full command line, argv joined by spaces (what `ps` prints). */
  readonly args: string
}

/**
 * The probe could not answer — distinct from "it answered, no engine". Callers
 * that report to a human must say "couldn't look", never invent an absence.
 */
export class PsProbeUnavailableError extends Error {
  constructor(reason: string) {
    super(`process probe unavailable: ${reason}`)
    this.name = "PsProbeUnavailableError"
  }
}

/**
 * Rows back to the `pid ppid args` text every consumer parses.
 *
 * The Windows branch produces ROWS (from CIM) and has to repair their
 * parentage before anyone walks them, but every caller downstream is written
 * against the snapshot TEXT and its one parser. Rendering back to text keeps
 * that single seam instead of forking the walk per platform.
 */
export function serializeProcRows(rows: readonly ProcRow[]): string {
  return rows.map((r) => `${r.pid} ${r.ppid} ${r.args}`).join("\n")
}
