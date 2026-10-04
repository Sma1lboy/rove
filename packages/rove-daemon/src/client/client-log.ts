/**
 * Client-side diagnostic log (mirror of `daemon/crash-log.ts`). Panes run in an
 * opentui alternate screen that paints over stdout/stderr, so lifecycle events
 * go to `<home>/.rove/client.log` instead.
 *
 * Best-effort and NON-BLOCKING: callers include the socket data handler and the
 * reconnect loop, so writes are fire-and-forget async `appendFile` (O_APPEND
 * keeps each line atomic across processes), never `appendFileSync`, and every
 * error is swallowed.
 */

import { appendFile, mkdir, rename, stat } from "node:fs/promises"
import { dirname } from "node:path"
import { DEFAULT_LOG_ROTATE_CAP_BYTES, shouldRotateLog } from "../daemon/log-rotate.ts"
import { defaultClientLogPath } from "../daemon/paths.ts"

/** Process role (`tasks`, `gui`, …); with the pid it attributes each line in the shared file. */
let context = "client"

/** Stamp every subsequent line with this process role. Call once at host boot. */
export function setClientLogContext(ctx: string): void {
  context = ctx
}

function coerceError(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) return { message: err.message, stack: err.stack }
  let text: string
  try {
    text = typeof err === "string" ? err : JSON.stringify(err)
  } catch {
    text = String(err)
  }
  return { message: text }
}

/** Format one client-log line: ISO stamp, context, pid, subsystem, message. */
export function formatClientEntry(subsystem: string, message: string, now: Date = new Date()): string {
  return `[${now.toISOString()}] client ${context} [${subsystem}] pid=${process.pid}: ${message}\n`
}

let warnedOnce = false

function warnOnce(): void {
  if (warnedOnce) return
  warnedOnce = true
  try {
    process.stderr.write("[rove] client log write failed; continuing without it\n")
  } catch {
    /* give up */
  }
}

// Keeps one process's lines in order; tests flush it via {@link flushClientLog}.
let writeChain: Promise<void> = Promise.resolve()

/**
 * Each process rotates on its own writes with no cross-process coordination;
 * a lost rename race is harmless. One generation kept (`.old`).
 */
async function rotateClientLogIfNeeded(path: string): Promise<void> {
  try {
    const { size } = await stat(path)
    if (!shouldRotateLog(size, DEFAULT_LOG_ROTATE_CAP_BYTES)) return
    await rename(path, `${path}.old`)
  } catch {
    /* best-effort — ENOENT (nothing written yet) or a lost race; never block a write over it */
  }
}

/** Queue a non-blocking append. ENOENT (fresh home) gets one mkdir + retry; other failures warn once. */
function append(line: string, logPath?: string): void {
  const path = logPath ?? defaultClientLogPath()
  writeChain = writeChain
    .then(async () => {
      await rotateClientLogIfNeeded(path)
      try {
        await appendFile(path, line)
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
          await mkdir(dirname(path), { recursive: true })
          await appendFile(path, line)
        } else {
          throw err
        }
      }
    })
    .catch(() => warnOnce())
}

/** Test-only: await all queued client-log writes (the fire-and-forget chain). */
export function flushClientLog(): Promise<void> {
  return writeChain
}

/**
 * Record a tagged client info line. Callers with an explicit `homeDir` MUST
 * pass `logPath`, or one home's diagnostics land in the ambient home's log.
 */
export function logClient(subsystem: string, message: string, logPath?: string): void {
  append(formatClientEntry(subsystem, message), logPath)
}

/** Record a tagged client error line with the error's message + stack. */
export function logClientError(subsystem: string, err: unknown): void {
  const e = coerceError(err)
  append(formatClientEntry(subsystem, e.stack ?? e.message))
}

let onRejection: ((reason: unknown) => void) | undefined
let onException: ((err: Error) => void) | undefined

/**
 * Pane-host crash net (mirror of {@link installDaemonCrashHandlers}). By
 * default one stray rejected fire-and-forget terminates the process and drops
 * the pane to a raw shell; with these it is logged as `crash-net` and the pane
 * keeps running. Idempotent.
 */
export function installClientCrashHandlers(): void {
  if (onRejection || onException) return
  onRejection = (reason) => logClientError("crash-net", reason)
  onException = (err) => logClientError("crash-net", err)
  process.on("unhandledRejection", onRejection)
  process.on("uncaughtException", onException)
}

/** Test-only: remove exactly our handlers (not `removeAllListeners`, which strips the runner's). */
export function resetClientCrashHandlersForTest(): void {
  if (onRejection) process.off("unhandledRejection", onRejection)
  if (onException) process.off("uncaughtException", onException)
  onRejection = undefined
  onException = undefined
}
