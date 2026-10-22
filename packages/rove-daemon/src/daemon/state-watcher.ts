/**
 * Publishes the shared state file (`state.json`: saved repos, machines, repo
 * and engine settings, prefs) on the `state` channel, whole, after every
 * change. Writers (CLI verbs, a TUI's kv flush, the bridge) keep their locked
 * per-key patches (`state/store.ts`); this is how every client sees them.
 * A client that kept its own boot-time copy would miss a repo another shell
 * added until restart.
 *
 * `terminalTabs.*` is left out: the tab store owns and publishes those
 * (`tabs.changed`). Same mechanics as `ui-prefs-watcher.ts`: stat-poll,
 * debounce, changed-only publish, an initial publish for replay.
 */

import { readFileSync } from "node:fs"
import { basename } from "node:path"
import { logDaemonError } from "./crash-log.ts"
import type { DaemonEventBus } from "./event-bus.ts"
import { startFileWatchTrigger } from "./file-watch-trigger.ts"

export const DEFAULT_STATE_DEBOUNCE_MS = 100

const TABS_PREFIX = "terminalTabs."

export interface SharedStatePayload {
  /** Every key except `terminalTabs.*`. Whole each time: one publisher, FIFO per socket, so the last one wins. */
  readonly state: Readonly<Record<string, unknown>>
}

/** Null when the file is unreadable or corrupt: keep the last published state rather than wipe clients. */
export function readSharedState(statePath: string): Record<string, unknown> | null {
  let text: string
  try {
    text = readFileSync(statePath, "utf8")
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ENOENT" ? {} : null
  }
  try {
    const parsed = JSON.parse(text) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(parsed)) if (!key.startsWith(TABS_PREFIX)) out[key] = value
    return out
  } catch {
    return null
  }
}

export function startStateWatcher(
  bus: Pick<DaemonEventBus, "publish">,
  statePath: string,
  debounceMs = DEFAULT_STATE_DEBOUNCE_MS,
): () => void {
  if (debounceMs <= 0) return () => {}
  let lastText: string | null = null
  const publishIfChanged = (): void => {
    const state = readSharedState(statePath)
    if (!state) return
    const text = JSON.stringify(state)
    if (text === lastText) return
    lastText = text
    bus.publish("state", { state })
  }
  const stop = startFileWatchTrigger({
    filePath: statePath,
    matchBasenames: [basename(statePath)],
    debounceMs,
    onTrigger: publishIfChanged,
    onError: (err) => logDaemonError("state-watcher", err),
  })
  publishIfChanged()
  return stop
}
