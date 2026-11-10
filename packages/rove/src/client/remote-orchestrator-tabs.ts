/**
 * The TUI's line to the daemon's tab store (`tabs-store.ts`): its RPCs, and
 * `tabs.changed` delivered to listeners one event at a time (never coalesced
 * like the `*Sig` cells, so two quick changes both land).
 */

import type { RoveDaemonClient } from "@sma1lboy/rove-daemon/client"
import type { SharedTabs, TabOp } from "@sma1lboy/rove-daemon/daemon/tabs-ops"
import type { TabsChangedPayload } from "@sma1lboy/rove-daemon/daemon/tabs-store"
import type { Unsubscribe } from "../orchestrator/core.ts"

export interface TabsApplyReply {
  readonly state: SharedTabs | null
  readonly rev: number
  readonly opened: readonly (string | null)[]
}

/** What `tabs-sync.ts` needs from a daemon: the RPCs and the change feed. */
export interface TabsTransport {
  apply(taskId: string, ops: readonly TabOp[]): Promise<TabsApplyReply>
  list(): Promise<{ tasks: Record<string, SharedTabs>; rev: number }>
  reserve(taskId: string, count: number): Promise<{ from: number; to: number }>
  release(taskId: string, from: number, to: number): Promise<unknown>
  onChanged(listener: (event: TabsChangedPayload) => void): Unsubscribe
}

export class TabsChannel implements TabsTransport {
  private readonly listeners = new Set<(event: TabsChangedPayload) => void>()

  constructor(private readonly client: RoveDaemonClient) {}

  /** Fed by the event decoder. */
  readonly emit = (event: TabsChangedPayload): void => {
    for (const listener of this.listeners) listener(event)
  }

  readonly onChanged = (listener: (event: TabsChangedPayload) => void): Unsubscribe => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly apply = (taskId: string, ops: readonly TabOp[]): Promise<TabsApplyReply> =>
    this.client.request<TabsApplyReply>("tabs.apply", { taskId, ops })

  readonly list = (): Promise<{ tasks: Record<string, SharedTabs>; rev: number }> =>
    this.client.request<{ tasks: Record<string, SharedTabs>; rev: number }>("tabs.list")

  readonly reserve = (taskId: string, count: number): Promise<{ from: number; to: number }> =>
    this.client.request<{ from: number; to: number }>("tabs.reserve", { taskId, count })

  readonly release = (taskId: string, from: number, to: number): Promise<unknown> =>
    this.client.request("tabs.release", { taskId, from, to })
}
