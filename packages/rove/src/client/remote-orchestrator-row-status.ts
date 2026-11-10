/**
 * The TUI's line to the daemon's row-status store (`row-status-store.ts`):
 * the `row.status` snapshots, `status.list` to catch up, and the two reports
 * only a client can make — what its user is looking at, and that its user
 * answered a question. The daemon decides every status; this only carries it.
 */

import type { RoveDaemonClient } from "@sma1lboy/rove-daemon/client"
import type { RowStatusPayload } from "@sma1lboy/rove-daemon/daemon/row-status-store"
import type { Unsubscribe } from "../orchestrator/core.ts"

/** What `row-status-sync.ts` needs from a daemon. */
export interface RowStatusTransport {
  list(): Promise<RowStatusPayload>
  /** This TUI now shows `tabId` of `taskId`; `taskId: null` = no workspace on screen. */
  viewing(taskId: string | null, tabId?: string | null): Promise<unknown>
  /** The user answered the question this tab was waiting on. */
  answered(taskId: string, tabId: string): Promise<unknown>
  onChanged(listener: (payload: RowStatusPayload) => void): Unsubscribe
}

export class RowStatusChannel implements RowStatusTransport {
  private readonly listeners = new Set<(payload: RowStatusPayload) => void>()

  constructor(private readonly client: RoveDaemonClient) {}

  /** Fed by the event decoder. */
  readonly emit = (payload: RowStatusPayload): void => {
    for (const listener of this.listeners) listener(payload)
  }

  readonly onChanged = (listener: (payload: RowStatusPayload) => void): Unsubscribe => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly list = (): Promise<RowStatusPayload> => this.client.request<RowStatusPayload>("status.list")

  readonly viewing = (taskId: string | null, tabId?: string | null): Promise<unknown> =>
    this.client.request("ui.viewing", taskId === null ? { taskId: null } : { taskId, ...(tabId ? { tabId } : {}) })

  readonly answered = (taskId: string, tabId: string): Promise<unknown> =>
    this.client.request("activity.answered", { taskId, tabId })
}
