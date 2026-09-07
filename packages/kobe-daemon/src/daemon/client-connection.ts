/**
 * Per-client wire layer of the daemon's Unix-socket transport — the
 * connection state each socket carries, newline-framed request parsing, and
 * the backpressure-aware write/broadcast paths. server.ts owns WHAT happens
 * to a request (dispatch, subscribe semantics); this module owns getting
 * frames on and off the wire safely.
 */

import type { Socket } from "node:net"
import type { ClientWriter } from "./client-writer.ts"
import { type ChannelName, type DaemonFrame, frameToLine } from "./protocol.ts"

export interface DaemonClientConnection {
  readonly id: number
  readonly connectedAt: Date
}

export type ClientState = DaemonClientConnection & {
  socket: Socket
  /**
   * Backpressure-aware writer for this socket (fix E). Every server→client
   * frame goes through it so a slow/stalled client buffers in a bounded
   * per-client queue (full snapshots replaced only by newer snapshots)
   * instead of letting Node queue unbounded heap on the long-lived daemon.
   * Lifecycle/response frames are never dropped. See {@link ClientWriter}.
   */
  writer: ClientWriter
  /** True once the client has called `subscribe` (broadcast target). */
  subscribed: boolean
  /**
   * True only when the client subscribed with `role: "gui"` — a real
   * front-end attach. This is the refcount that gates lazy shutdown; a
   * helper pane (`role: "pane"`) is `subscribed` (gets channels) but NOT
   * `holdsLifetime`, so closing it never stops the daemon.
   */
  holdsLifetime: boolean
  /**
   * Per-channel subscribe filter (KOB — per-channel subscribe). `null` =
   * "no filter, deliver every channel" — what a subscriber that omits
   * `channels` gets. A non-null set restricts both the connect-time replay
   * AND every later `broadcast` to the named channels, so a narrow consumer
   * (e.g. host-boot's UiPrefsSync, which only wants `ui-prefs` +
   * `keybindings`) never receives — or deserializes — the full
   * `task.snapshot` fan-out it does not read. The
   * `daemon.stopping` lifecycle frame is NOT a channel and bypasses this
   * filter (every subscriber must learn the daemon is going down).
   */
  channels: ReadonlySet<ChannelName> | null
}

/** Only full-channel snapshots are replaceable. Per-task/repo updates and
 * commands retain every frame: replay alone cannot reconstruct their history. */
function replacementKey(frame: DaemonFrame): string | null {
  if (frame.type !== "event") return null
  switch (frame.name) {
    case "task.snapshot":
    case "active-task":
    case "update":
    case "attention.inbox":
    case "ui-prefs":
    case "worktree.changes":
    case "transcript.activity":
    case "usage.snapshot":
    case "usage.context":
      return frame.name
    default:
      return null
  }
}

export function writeFrame(client: Pick<ClientState, "writer">, frame: DaemonFrame): void {
  client.writer.write(frameToLine(frame), replacementKey(frame))
}

export function broadcast(clients: ReadonlySet<ClientState>, frame: DaemonFrame): void {
  // Serialize ONCE per publish, not once per subscriber: a task.snapshot
  // frame is ~8.5KB at 20 tasks, so N subscribers would otherwise cost N
  // identical JSON.stringify passes per task mutation. The wire bytes are
  // unchanged — every subscriber receives the exact same line.
  //
  // Per-channel filter (KOB — per-channel subscribe): a channel event is
  // skipped for a client whose `channels` filter excludes it, so a narrow
  // consumer never receives (or parses) fan-out it does not read. The
  // `daemon.stopping` lifecycle frame is NOT a channel — it bypasses the
  // filter so every subscriber learns the daemon is going down.
  const channel = frame.type === "event" && frame.name !== "daemon.stopping" ? (frame.name as ChannelName) : null
  // Backpressure (fix E): each client's writer obeys its own socket's drain
  // signal and buffers in a bounded per-client queue, so one slow client can
  // neither stall the fan-out for healthy clients nor grow the daemon heap
  // unbounded. Replacement policy is identical for all clients, so compute it once.
  const replaceKey = replacementKey(frame)
  let line: string | null = null
  for (const client of clients) {
    if (!client.subscribed && frame.type === "event") continue
    if (channel && client.channels && !client.channels.has(channel)) continue
    line ??= frameToLine(frame)
    client.writer.write(line, replaceKey)
  }
}

/**
 * Parse one complete request line from LineReceiver and hand it to `onRequest`. A malformed line (bad JSON / non-request
 * frame) answers with a bare `{ message }` parse-error response — it never
 * carried an Error `name` on the wire, and keeping that here preserves the
 * exact bytes.
 */
export function handleClientLine(
  client: ClientState,
  line: string,
  onRequest: (req: Extract<DaemonFrame, { type: "request" }>, client: ClientState) => void,
): void {
  if (line.trim().length === 0) return
  try {
    const frame = JSON.parse(line) as DaemonFrame
    if (frame.type !== "request") throw new Error("daemon only accepts request frames from clients")
    onRequest(frame, client)
  } catch (err) {
    writeFrame(client, {
      type: "response",
      id: "parse-error",
      error: { message: err instanceof Error ? err.message : String(err) },
    })
  }
}
