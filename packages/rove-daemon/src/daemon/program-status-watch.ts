import { RoveDaemonClient } from "../client/index"
import { logDaemonError } from "./crash-log"
import { defaultPtyHostSocketPath } from "./paths"
import { type ProgramStatusEvent, parseProgramStatusEvent } from "./program-status-event"

/** A non-GUI subscription; it reconnects but never starts a PTY host. */
export function watchProgramStatus(
  receive: (event: ProgramStatusEvent) => Promise<void>,
  options: { homeDir?: string; socketPath?: string; retryMs?: number } = {},
): () => Promise<void> {
  let stopped = false
  let client: RoveDaemonClient | undefined
  let retry: ReturnType<typeof setTimeout> | undefined
  let connecting: Promise<void> | undefined
  const baseDelay = options.retryMs ?? 1000
  // Doubles while no PTY host answers (a headless daemon may never get one); a watch resets it.
  let delay = baseDelay
  const deliveries = new Set<Promise<void>>()
  const schedule = () => {
    if (stopped || retry) return
    retry = setTimeout(() => {
      retry = undefined
      connect()
    }, delay)
    retry.unref?.()
  }
  const connect = () => {
    if (stopped || connecting) {
      schedule()
      return
    }
    const connection = new RoveDaemonClient(options.socketPath ?? defaultPtyHostSocketPath(options.homeDir))
    client = connection
    connection.on("pty.programStatus", (frame) => {
      if (stopped) return
      const event = parseProgramStatusEvent(frame.payload)
      if (!event) return
      const delivery = receive(event).catch((err) => logDaemonError("program-status", err))
      deliveries.add(delivery)
      void delivery.then(() => deliveries.delete(delivery))
    })
    connection.onLifecycle("close", schedule)
    connecting = connection
      .connect()
      .then(async () => {
        if (stopped) return
        await connection.request("pty.watchStatus")
        delay = baseDelay
      })
      .catch(() => {
        delay = Math.min(delay * 2, Math.max(baseDelay, 5000))
        connection.close()
        schedule()
      })
      .finally(() => {
        connecting = undefined
      })
  }
  connect()
  return async () => {
    stopped = true
    if (retry) clearTimeout(retry)
    client?.close()
    await connecting
    await Promise.allSettled(deliveries)
  }
}
