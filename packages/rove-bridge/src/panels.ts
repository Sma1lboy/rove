/**
 * `rove api panel-show` requests, as the daemon's `panel.show` channel carries them, fanned out to
 * every browser as a `panel` push. The daemon replays its latest event to a new subscriber and
 * re-delivers it on reconnect, so a request is dropped when its `at` was seen or is stale: a
 * replay must not pop a panel nobody asked for just now.
 */

import type { ChannelPayloads } from "@sma1lboy/rove-daemon/daemon/protocol"
import { STALE_NOTICE_MS } from "./notices.ts"

export type PanelShowPayload = ChannelPayloads["panel.show"]

const VIEWS: readonly string[] = ["browser", "files", "diff"]

export class PanelFeed {
  private readonly listeners = new Set<(panel: PanelShowPayload) => void>()
  private lastKey = ""
  private lastAt = 0

  constructor(private readonly now: () => number = Date.now) {}

  push(panel: PanelShowPayload | null | undefined): void {
    if (!panel || typeof panel.taskId !== "string" || typeof panel.at !== "number" || !VIEWS.includes(panel.view))
      return
    const { taskId, view, url, path, at } = panel
    // Two requests can share a millisecond; the same one arriving twice is the replay.
    const key = JSON.stringify([at, taskId, view, url, path])
    if (at < this.lastAt || key === this.lastKey) return
    this.lastAt = at
    this.lastKey = key
    if (this.now() - at > STALE_NOTICE_MS) return
    const clean: PanelShowPayload = {
      taskId,
      view,
      at,
      ...(typeof url === "string" ? { url } : {}),
      ...(typeof path === "string" ? { path } : {}),
    }
    for (const listener of this.listeners) listener(clean)
  }

  subscribe(listener: (panel: PanelShowPayload) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
