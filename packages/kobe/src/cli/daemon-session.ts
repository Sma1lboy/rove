/**
 * Connect / work / close lifecycle for short-lived CLI processes, so a
 * command never leaks a socket.
 *
 *   - `"start"` (default): spawn the daemon if absent (`connectOrStartDaemon`).
 *   - `"require-running"`: never spawn (a git hook must not boot a daemon);
 *     resolves `null` when no daemon answers.
 */

import type { KobeDaemonClient } from "@sma1lboy/kobe-daemon/client"
import { connectIfRunning, connectOrStartDaemon } from "@sma1lboy/kobe-daemon/client/daemon-process"
import type {
  ChannelName,
  ChannelPayloads,
  DaemonRequestName,
  SubscribeRole,
} from "@sma1lboy/kobe-daemon/daemon/protocol"

/** The narrow client surface a CLI verb handler may touch; tests fake it. */
export interface DaemonRpc {
  request<T = unknown>(name: DaemonRequestName, payload?: unknown): Promise<T>
  subscribe(opts?: { channels?: readonly ChannelName[]; role?: SubscribeRole }): Promise<unknown>
  onChannel<C extends ChannelName>(channel: C, handler: (payload: ChannelPayloads[C]) => void): () => void
}

/** An open connection plus the one cleanup hook the caller must run. */
export interface DaemonSession {
  readonly client: KobeDaemonClient
  /** Idempotent: closes the socket; safe to call from a `finally`. */
  close(): void
}

export interface DaemonSessionOptions {
  /** `"start"` (default) auto-spawns an absent daemon; `"require-running"` never spawns. */
  readonly mode?: "start" | "require-running"
}

/** `"start"` throws when unreachable; `"require-running"` resolves `null`. */
export async function openDaemonSession(opts?: { readonly mode?: "start" }): Promise<DaemonSession>
export async function openDaemonSession(opts: DaemonSessionOptions): Promise<DaemonSession | null>
export async function openDaemonSession(opts: DaemonSessionOptions = {}): Promise<DaemonSession | null> {
  const client = opts.mode === "require-running" ? await connectIfRunning() : await connectOrStartDaemon()
  if (!client) return null
  return { client, close: () => client.close() }
}

/** The `active-task` channel's replayed value, read once. */
export async function resolveActiveTaskId(client: DaemonRpc): Promise<string | null> {
  let activeId: string | null = null
  const off = client.onChannel("active-task", (payload) => {
    activeId = payload.taskId
  })
  try {
    await client.subscribe()
  } finally {
    off()
  }
  return activeId
}
