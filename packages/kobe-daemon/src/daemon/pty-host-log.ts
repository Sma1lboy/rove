/**
 * One log-line format for the PTY host, shared by both entry points.
 * Timestamped in the `formatDaemonInfo` shape so `pty.log` interleaves with
 * `daemon.log` — the diagnostic for "who ended this session". Its own module
 * because the node Windows entry can't import the Bun-side crash-log.
 */

/** `[<ISO>] pty-host [<event>]: <message>` — no trailing newline (console.log adds it). */
export function formatPtyHostLine(event: string, message: string, now: Date = new Date()): string {
  return `[${now.toISOString()}] pty-host [${event}]: ${message}`
}
