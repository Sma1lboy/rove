/**
 * The TUI end of `terminalTab.peerSync`: this TUI's id on the channel, the
 * listeners that apply other TUIs' tab changes, and the relay of its own.
 * Unlike the `*Sig` cells, every event is delivered (two quick closes both land).
 */

import { randomUUID } from "node:crypto"
import type { RoveDaemonClient } from "@sma1lboy/rove-daemon/client"
import type { Unsubscribe } from "../orchestrator/core.ts"
import type { PeerTabEvent } from "./remote-orchestrator-contract.ts"
import { reportPeerTabOp } from "./remote-orchestrator-writes.ts"

/** A relayed tab change older than this is a reconnect replay; the tabs already caught up. */
const PEER_TAB_STALE_MS = 10_000

export class PeerTabChannel {
  /** This TUI's id on the channel, so it skips its own relayed changes. */
  readonly instanceId = randomUUID()
  private readonly listeners = new Set<(event: PeerTabEvent) => void>()

  constructor(private readonly client: RoveDaemonClient) {}

  /** Fed by the event decoder. */
  readonly emit = (event: PeerTabEvent): void => {
    if (event.origin === this.instanceId || Date.now() - event.at > PEER_TAB_STALE_MS) return
    for (const listener of this.listeners) listener(event)
  }

  /** Another TUI's tab open/close, one call per event. */
  readonly on = (listener: (event: PeerTabEvent) => void): Unsubscribe => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Tell the other attached TUIs about this one's tab open/close. */
  readonly report = (change: Parameters<typeof reportPeerTabOp>[2]): void =>
    reportPeerTabOp(this.client, this.instanceId, change)
}
