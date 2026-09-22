/**
 * Typed pub/sub for channel events ({@link ../daemon/protocol.ts ChannelPayloads}).
 *
 *   - **fan-out**: `publish` notifies every sink (the server wires ONE that
 *     writes frames to subscribed sockets).
 *   - **last-value-per-channel**: a LATE subscriber gets each channel's current
 *     value via `snapshot()`. An event-log channel would replay only its last
 *     item (call that out at definition time).
 *
 * Synchronous. `daemon.stopping` is NOT a channel and never flows through here.
 */

import type { ChannelName, ChannelPayloads } from "./protocol.ts"

export interface ChannelEvent<C extends ChannelName = ChannelName> {
  readonly channel: C
  readonly payload: ChannelPayloads[C]
}

export class DaemonEventBus {
  private readonly last = new Map<ChannelName, unknown>()
  private readonly sinks = new Set<(event: ChannelEvent) => void>()

  /** Publish a channel's latest payload: cache it + fan out to all sinks. */
  publish<C extends ChannelName>(channel: C, payload: ChannelPayloads[C]): void {
    this.last.set(channel, payload)
    const event = { channel, payload } as ChannelEvent
    for (const sink of this.sinks) sink(event)
  }

  /** Current value of every populated channel — the late-subscriber replay set. */
  snapshot(): ChannelEvent[] {
    return [...this.last].map(([channel, payload]) => ({ channel, payload }) as ChannelEvent)
  }

  /** Register a fan-out sink; returns an unsubscribe. */
  onPublish(sink: (event: ChannelEvent) => void): () => void {
    this.sinks.add(sink)
    return () => {
      this.sinks.delete(sink)
    }
  }
}
