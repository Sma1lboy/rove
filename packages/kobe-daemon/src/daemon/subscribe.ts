/**
 * `subscribe` — the ONE request that isn't a registry handler: it is
 * connection lifecycle (mutates per-socket state, drives the gui-refcount
 * idle grace, writes replay frames out-of-band), not payload→result RPC.
 */

import type { DaemonActivityRegistry } from "./activity-registry.ts"
import type { CellPixelSize } from "./channels-events.ts"
import { type ChannelName, normalizeChannelFilter } from "./channels.ts"
import { logDaemonInfo } from "./crash-log.ts"
import type { DaemonEventBus } from "./event-bus.ts"
import type { DaemonLifetime } from "./lifetime.ts"
import type { DaemonEventName } from "./protocol.ts"

/** The per-connection state `subscribe` mutates. */
export interface SubscribingClient {
  readonly id: number
  subscribed: boolean
  holdsLifetime: boolean
  channels: ReadonlySet<ChannelName> | null
  cellPixelSize: CellPixelSize | null
}

/**
 * Cell pixel size the GUI measured on its OWN tty, or `null` for terminals
 * declining `CSI 16 t` — never a guess; `graphics.write` then refuses.
 */
function readCellPixelSize(payload: Record<string, unknown>): CellPixelSize | null {
  const width = payload.cellPixelWidth
  const height = payload.cellPixelHeight
  if (typeof width !== "number" || typeof height !== "number") return null
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null
  if (width <= 0 || height <= 0) return null
  return { width, height }
}

export interface SubscribeDeps {
  readonly bus: DaemonEventBus
  readonly activity: DaemonActivityRegistry
  readonly lifetime: DaemonLifetime
  readonly clientCount: () => number
  readonly writeEvent: (client: SubscribingClient, name: DaemonEventName, payload: unknown) => void
}

/** Handle one `subscribe`. Returns the (empty) response payload. */
export function handleSubscribe(
  client: SubscribingClient,
  payload: Record<string, unknown>,
  deps: SubscribeDeps,
): Record<string, never> {
  const wasSubscribed = client.subscribed
  client.subscribed = true
  // Omitted role = "pane", so no client can accidentally pin the daemon open.
  const role = payload.role === "gui" ? "gui" : "pane"
  client.holdsLifetime = role === "gui"
  // `null` = every channel (omitted/garbage `channels` included). A set
  // restricts this replay and every later `broadcast`.
  client.channels = normalizeChannelFilter(payload.channels)
  // Only a GUI owns a real tty, so only a GUI's measurement means anything.
  client.cellPixelSize = client.holdsLifetime ? readCellPixelSize(payload) : null
  const firstSubscriber = !wasSubscribed
  // Only a GUI cancels the lazy-shutdown grace; panes never keep the daemon up.
  if (client.holdsLifetime) deps.lifetime.guiAttached()
  logDaemonInfo(
    "conn",
    `client #${client.id} subscribed as ${role}${client.channels ? ` [${[...client.channels].join(",")}]` : ""} — ${deps.clientCount()} client(s), ${deps.lifetime.guiCount()} gui${firstSubscriber ? " (collectors resume)" : ""}`,
  )
  // Replay each populated channel's last value so a late subscriber hydrates.
  for (const event of deps.bus.snapshot()) {
    if (client.channels && !client.channels.has(event.channel)) continue
    deps.writeEvent(client, event.channel as DaemonEventName, event.payload)
  }
  // The bus caches ONE value per channel but `engine-state` is per-task, so
  // replay the full activity snapshot (known-idle tab entries on purpose).
  if (!client.channels || client.channels.has("engine-state")) {
    for (const payload of deps.activity.replaySnapshot()) {
      deps.writeEvent(client, "engine-state", payload)
    }
  }
  return {}
}
