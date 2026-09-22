/**
 * The shared vocabulary of the process probe: one row of the process table,
 * the way rows are written back out, and the error that means "I could not
 * look" as opposed to "I looked and found nothing".
 *
 * Its own module so the two probe sources (`foreground.ts` POSIX `ps`,
 * `win-process-snapshot.ts` CIM/ConPTY) don't import each other.
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
 * Rows back to the `pid ppid args` text every consumer parses. Windows builds
 * ROWS (from CIM, parentage repaired); rendering to text keeps one parser
 * instead of forking the walk per platform.
 */
export function serializeProcRows(rows: readonly ProcRow[]): string {
  return rows.map((r) => `${r.pid} ${r.ppid} ${r.args}`).join("\n")
}
