/**
 * Daemon crash net + diagnostics. The daemon runs detached with stdout/stderr
 * in `daemon.log` (`client/daemon-process.ts`). Without these handlers the
 * runtime's default kills the process on any stray rejection from its many
 * fire-and-forget `void someAsync()` calls — silently under a
 * `stdio: "ignore"` spawn. Here they are logged and the daemon keeps serving:
 * requests are independent, so a logged incident beats a silent death.
 * Event-loop drain and SIGKILL still end it.
 */

/** Coerce any thrown value into an Error so the log has a stack to print. */
function toError(err: unknown): Error {
  if (err instanceof Error) return err
  let text: string
  try {
    text = typeof err === "string" ? err : JSON.stringify(err)
  } catch {
    text = String(err)
  }
  return new Error(text)
}

/** Render one crash-log line: ISO timestamp, kind, and full stack. */
export function formatCrashEntry(
  kind: "uncaughtException" | "unhandledRejection",
  err: unknown,
  now: Date = new Date(),
): string {
  const e = toError(err)
  return `[${now.toISOString()}] daemon ${kind}: ${e.stack ?? `${e.name}: ${e.message}`}\n`
}

/** Daemon error line tagged with the catching subsystem (`rc-bridge`, …) —
 *  unlike {@link formatCrashEntry}, which can't know where an error came from. */
export function formatDaemonError(subsystem: string, err: unknown, now: Date = new Date()): string {
  const e = toError(err)
  return `[${now.toISOString()}] daemon error [${subsystem}]: ${e.stack ?? `${e.name}: ${e.message}`}\n`
}

/** For the `.catch` of a fire-and-forget call, so a failure is pinned to its
 *  subsystem instead of an anonymous `unhandledRejection`. */
export function logDaemonError(subsystem: string, err: unknown): void {
  process.stderr.write(formatDaemonError(subsystem, err))
}

/** Render a daemon INFO line (non-error lifecycle events). */
export function formatDaemonInfo(subsystem: string, message: string, now: Date = new Date()): string {
  return `[${now.toISOString()}] daemon [${subsystem}]: ${message}\n`
}

/** Expected events, e.g. connection lifecycle (subscribe / disconnect /
 *  idle-arm / idle-stop), so a desynced pane can be correlated with the
 *  daemon's view of the socket churn. */
export function logDaemonInfo(subsystem: string, message: string): void {
  process.stderr.write(formatDaemonInfo(subsystem, message))
}

let onRejection: ((reason: unknown) => void) | undefined
let onException: ((err: Error) => void) | undefined

/**
 * Install the crash handlers. Daemon entry only — they mutate global
 * `process` state, so never from code shared with the TUI or tests.
 * Idempotent, so duplicate handlers can't stack.
 */
export function installDaemonCrashHandlers(log: (line: string) => void = (l) => process.stderr.write(l)): void {
  if (onRejection || onException) return
  onRejection = (reason) => log(formatCrashEntry("unhandledRejection", reason))
  onException = (err) => log(formatCrashEntry("uncaughtException", err))
  process.on("unhandledRejection", onRejection)
  process.on("uncaughtException", onException)
}

/** Test-only: remove exactly our handlers (not `removeAllListeners`, which
 *  strips the test runner's too) and clear the idempotency latch. */
export function resetDaemonCrashHandlersForTest(): void {
  if (onRejection) process.off("unhandledRejection", onRejection)
  if (onException) process.off("uncaughtException", onException)
  onRejection = undefined
  onException = undefined
}
