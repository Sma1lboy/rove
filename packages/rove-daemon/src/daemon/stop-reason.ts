/**
 * WHY a daemon is going away, on the `daemon.stopping` frame (v5). Clients only
 * wait out `idle`/`socket-lost`/`stop`; `restart` replaces the CODE, so an
 * attached TUI can offer a refresh at once instead of after reconnect + `hello`.
 * `stop` is the default, so an unlabelled stop never claims to be a restart.
 */
export type DaemonStopReason = "restart" | "stop" | "idle" | "socket-lost"

/**
 * The `daemon.stopping` frame's payload. Every field optional: a v4 daemon
 * broadcasts `{}`, and a v4 client ignores what it does not know — so this
 * shape may only ever GROW optional fields.
 */
export interface DaemonStoppingPayload {
  readonly reason?: DaemonStopReason
  /** Outgoing build version, comparable without waiting for the next `hello`. */
  readonly roveVersion?: string
}

/** Unknown/absent → `undefined` (an older daemon, or a reason this build doesn't know). */
export function parseDaemonStopReason(value: unknown): DaemonStopReason | undefined {
  return value === "restart" || value === "stop" || value === "idle" || value === "socket-lost" ? value : undefined
}
