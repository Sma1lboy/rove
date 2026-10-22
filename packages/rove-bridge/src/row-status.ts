/**
 * The daemon's row status (`rove-daemon/src/daemon/row-status-store.ts`), as the bridge holds it:
 * the whole `row.status` snapshot (highest `rev` wins, `status.list` on every (re)connect), and the
 * two reports only a client can make, sent for the browsers behind this bridge. Each browser
 * connection is its own `viewer`, so the daemon tracks what every one of them looks at; a viewer
 * that leaves is cleared with `taskId: null`. The bridge derives no status itself.
 */

import type { TaskStatus } from "@sma1lboy/rove-daemon/daemon/row-status"
import type { RowStatusPayload } from "@sma1lboy/rove-daemon/daemon/row-status-store"

/** The slice of `RoveDaemonClient` this feed uses (faked in tests). */
export interface StatusClient {
  request(name: "status.list" | "ui.viewing" | "activity.answered", payload?: unknown): Promise<unknown>
  on(name: "row.status", handler: (frame: { payload: unknown }) => void): () => void
}

export type RowStatuses = Readonly<Record<string, TaskStatus>>

function isPayload(value: unknown): value is RowStatusPayload {
  return (
    !!value &&
    typeof value === "object" &&
    "tasks" in value &&
    !!value.tasks &&
    typeof value.tasks === "object" &&
    "rev" in value &&
    typeof value.rev === "number"
  )
}

export class RowStatusFeed {
  private statuses: RowStatuses | null = null
  private rev = -1
  /** viewer → what that browser shows, re-sent after a reconnect (the daemon forgets a closed connection's). */
  private readonly viewing = new Map<string, { taskId: string; tabId: string | null }>()
  private readonly listeners = new Set<() => void>()

  constructor(private readonly client: StatusClient) {
    client.on("row.status", (frame) => this.accept(frame.payload, false))
  }

  /** Every task's status; null until the daemon first answered. */
  current(): RowStatuses | null {
    return this.statuses
  }

  /**
   * (Re)connected: take the daemon's whole snapshot as is (a restarted daemon counts `rev` from
   * zero again), then report again what each browser shows.
   */
  async resync(): Promise<void> {
    this.accept(await this.client.request("status.list"), true)
    for (const [viewer, view] of this.viewing) this.sendViewing(viewer, view.taskId, view.tabId)
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** `viewer` (one browser connection) now shows this task/tab; `taskId` null = nothing, or it left. */
  setViewing(viewer: string, taskId: string | null, tabId: string | null): void {
    const known = this.viewing.get(viewer)
    if (taskId === null) {
      if (!this.viewing.delete(viewer)) return
    } else {
      if (known?.taskId === taskId && known.tabId === tabId) return
      this.viewing.set(viewer, { taskId, tabId })
    }
    this.sendViewing(viewer, taskId, tabId)
  }

  /**
   * Keystrokes a browser typed into a session (`term.input`): Enter into a tab that is asking
   * answers it, as Enter does in the TUI. `stream` is `<taskId>::<tabId>[::<leafId>]`.
   */
  noteInput(stream: string, data: string): void {
    if (!(data === "\r" || data.endsWith("\r"))) return
    const [taskId, tabId] = stream.split("::")
    if (!taskId || !tabId) return
    if (this.statuses?.[taskId]?.tabs[tabId]?.kind !== "needs-input") return
    this.client.request("activity.answered", { taskId, tabId }).catch(() => {
      // An older daemon, or one mid-restart: the `?` stays until the engine reports again.
    })
  }

  private sendViewing(viewer: string, taskId: string | null, tabId: string | null): void {
    this.client.request("ui.viewing", { viewer, taskId, ...(taskId !== null && tabId ? { tabId } : {}) }).catch(() => {
      // Lost with the connection; `resync` sends it again.
    })
  }

  private accept(payload: unknown, reset: boolean): void {
    if (!isPayload(payload) || (!reset && payload.rev <= this.rev)) return
    this.rev = payload.rev
    this.statuses = payload.tasks
    for (const listener of this.listeners) listener()
  }
}
