/**
 * The daemon's dispatch ledger (`rove-daemon/src/daemon/dispatch-ledger.ts`) as the bridge holds
 * it: the whole `dispatch.snapshot`, highest `rev` wins, `dispatch.list` on every (re)connect.
 * Pushed to every browser as a `dispatch` event; the bridge derives nothing itself.
 */

import type { DispatchSnapshot } from "@sma1lboy/rove-daemon/daemon/dispatch-ledger"

/** The slice of `RoveDaemonClient` this feed uses (faked in tests). */
export interface DispatchClient {
  request(name: "dispatch.list"): Promise<unknown>
  on(name: "dispatch.snapshot", handler: (frame: { payload: unknown }) => void): () => void
}

function isSnapshot(value: unknown): value is DispatchSnapshot {
  return (
    !!value &&
    typeof value === "object" &&
    "rows" in value &&
    Array.isArray(value.rows) &&
    "rev" in value &&
    typeof value.rev === "number"
  )
}

export class DispatchFeed {
  private snapshot: DispatchSnapshot | null = null
  private readonly listeners = new Set<(snapshot: DispatchSnapshot) => void>()

  constructor(private readonly client: DispatchClient) {
    client.on("dispatch.snapshot", (frame) => this.accept(frame.payload, false))
  }

  current(): DispatchSnapshot | null {
    return this.snapshot
  }

  /** (Re)connected: take the daemon's snapshot as is (a restarted daemon counts `rev` from zero). An older daemon has no ledger. */
  async resync(): Promise<void> {
    this.accept(await this.client.request("dispatch.list").catch(() => null), true)
  }

  subscribe(listener: (snapshot: DispatchSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private accept(value: unknown, whole: boolean): void {
    if (!isSnapshot(value)) return
    if (!whole && this.snapshot && value.rev <= this.snapshot.rev) return
    this.snapshot = value
    for (const listener of this.listeners) listener(value)
  }
}
