/** Per-client wire layer: connection state, request-line parsing, backpressure-aware writes. server.ts owns dispatch. */

import type { Socket } from "node:net"
import type { CellPixelSize } from "./channels-events.ts"
import type { ClientWriter } from "./client-writer.ts"
import { type ChannelName, type DaemonFrame, frameToLine } from "./protocol.ts"

export interface DaemonClientConnection {
  readonly id: number
  readonly connectedAt: Date
}

export type ClientState = DaemonClientConnection & {
  socket: Socket
  /**
   * Every server→client frame goes through this bounded per-client queue
   * (snapshots replaced only by newer snapshots) so a stalled client can't
   * grow daemon heap unbounded. Lifecycle/response frames are never dropped.
   * See {@link ClientWriter}.
   */
  writer: ClientWriter
  /** True once the client has called `subscribe` (broadcast target). */
  subscribed: boolean
  /**
   * True only for `role: "gui"` subscribers — the refcount gating lazy
   * shutdown. A `role: "pane"` helper is `subscribed` but never holds lifetime.
   */
  holdsLifetime: boolean
  /**
   * Channel filter; `null` (no `channels` in subscribe) = every channel. A set
   * restricts both connect-time replay AND later broadcasts, sparing narrow
   * consumers the `task.snapshot` fan-out. `daemon.stopping` is not a channel
   * and bypasses it: every subscriber must learn the daemon is going down.
   */
  channels: ReadonlySet<ChannelName> | null
  /** Cell pixel size the GUI measured at boot; `null` for a pane or a terminal
   *  that declined. `graphics.write` refuses rather than guess without one. */
  cellPixelSize: CellPixelSize | null
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
  // Serialize once per publish: a task.snapshot is ~8.5KB at 20 tasks.
  // `daemon.stopping` is not a channel, so it bypasses `channels` filters.
  const channel = frame.type === "event" && frame.name !== "daemon.stopping" ? (frame.name as ChannelName) : null
  // Per-client writers drain independently, so one slow client can't stall the rest.
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
 * Parse one request line and hand it to `onRequest`. A malformed line answers
 * a bare `{ message }` parse error — no Error `name`, preserving wire bytes.
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
