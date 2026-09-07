/**
 * One log-line format for the PTY host, shared by both entry points.
 *
 * `pty.log` used to carry bare `[pty-host <event>] <message>` lines with no
 * time on them, while `daemon.log` next to it carried an ISO prefix. Reading
 * the two side by side is the whole diagnostic for "who ended this session":
 * without a timestamp here, a session death can only be placed relative to
 * other pty.log lines, and two readers of the same incident put the same
 * death nine minutes apart.
 *
 * Same shape as `formatDaemonInfo` (crash-log.ts) so the two logs interleave
 * cleanly, but kept in its own module because the Windows host entry runs
 * under node and stays out of the Bun-side crash-log module by design.
 */

/** `[<ISO>] pty-host [<event>]: <message>` — no trailing newline (console.log adds it). */
export function formatPtyHostLine(event: string, message: string, now: Date = new Date()): string {
  return `[${now.toISOString()}] pty-host [${event}]: ${message}`
}
