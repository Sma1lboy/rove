/**
 * The PTY host (no daemon-socket connection) persists abnormal child exits to
 * `pty-exits.json`. The daemon watches it, diffs records by key + `at`, and
 * per NEW record fires a `session.exited` plugin event and marks the tab
 * `dead` — a SIGTERM'd engine fires no hook, so otherwise it reads as idle.
 * The first successful read is baseline: pre-existing corpses must not re-fire.
 */

import type { PluginHost } from "../plugins/runtime.ts"
import type { DaemonActivityRegistry } from "./activity-registry.ts"
import type { AttentionInboxStore } from "./attention-inbox.ts"
import { startFileWatchTrigger } from "./file-watch-trigger.ts"
import { defaultPtyExitsPath } from "./paths.ts"
import { ENGINE_EXIT_BANNER, type PtyExitRecord, readPtyExitStore } from "./pty-exit-store.ts"

const DEBOUNCE_MS = 250
/** Session key shape: `taskId::tabId` (pty registry convention). */
const KEY_RE = /^(.+?)::(.+)$/

export interface PtyExitWatchOptions {
  readonly homeDir?: string
  readonly plugins: () => Pick<PluginHost, "handleUiReport"> | null
  /** Activity registry — where a death becomes the tab's live badge. */
  readonly activity?: Pick<DaemonActivityRegistry, "recordEngineDeath">
  /** Attention Inbox — the durable record once the badge scrolls away. */
  readonly inbox?: Pick<AttentionInboxStore, "recordEngineDeath">
  readonly log?: (line: string) => void
  /** Test seam. */
  readonly path?: string
}

export function startPtyExitWatch(opts: PtyExitWatchOptions): () => void {
  const path = opts.path ?? defaultPtyExitsPath(opts.homeDir)
  const seen = new Map<string, string>()
  /** True once ONE read succeeded — at start, or on a later sweep if unreadable then. */
  let baselined = false

  const sweep = (): void => {
    const host = opts.plugins()
    // No host = don't mark records seen, so a fire is deferred, not lost.
    if (!host) return
    const { records, readable } = readPtyExitStore(path)
    // Unreadable is NOT empty: the prune below would empty `seen` and the next
    // sweep would re-fire every old record, burying the oldest-first Inbox.
    if (!readable) return
    // Keyed by the STORE key, not `record.key`: engine records live under
    // `<session key>#engine` with the bare key inside, so `record.key` would
    // collide pty/engine records and fail the prune — re-firing forever.
    for (const [storeKey, record] of Object.entries(records)) {
      if (seen.get(storeKey) === record.at) continue
      seen.set(storeKey, record.at)
      // Absorb until baselined: losing one notification beats re-announcing fifty old deaths.
      if (!baselined) continue
      host.handleUiReport({ kind: "session.exited", ...exitReport(record) })
      publishDeath(record)
    }
    baselined = true
    // The file caps at 50 records; prune dropped keys so `seen` tracks it.
    for (const key of seen.keys()) if (!(key in records)) seen.delete(key)
  }

  /** Turn a death record into the tab's `dead` activity state + Inbox item. */
  const publishDeath = (record: PtyExitRecord): void => {
    const registry = opts.activity
    if (!registry && !opts.inbox) return
    const death = engineDeathOf(record)
    if (!death) return
    const { taskId, tabId, exit, at } = death
    registry?.recordEngineDeath(taskId, tabId, exit, at)
    opts.inbox
      ?.recordEngineDeath(taskId, tabId, { exit }, at)
      .catch((err) => opts.log?.(`pty-exit inbox: ${String(err)}`))
  }

  // Watch BEFORE the baseline read (the trigger stamps synchronously), so no
  // record can fall between the two and lose its `session.exited`.
  const stop = startFileWatchTrigger({
    filePath: path,
    debounceMs: DEBOUNCE_MS,
    onTrigger: sweep,
    onError: (err) => opts.log?.(`pty-exit watch: ${String(err)}`),
  })
  // Unreadable here leaves `baselined` false; the first readable sweep baselines instead.
  const initial = readPtyExitStore(path)
  if (initial.readable) {
    for (const [storeKey, record] of Object.entries(initial.records)) seen.set(storeKey, record.at)
    baselined = true
  }
  return stop
}

/**
 * Null when the key names no tab, or the timestamp is unparseable — guessing
 * `now` would let an OLD record bury a live engine. Shared with the boot
 * reconciler so both caption the same death the same way.
 */
export function engineDeathOf(record: PtyExitRecord): {
  taskId: string
  tabId: string
  exit: { code: number | null; signal: string | null; lastLine?: string }
  at: number
} | null {
  const match = KEY_RE.exec(record.key)
  const taskId = match?.[1]
  const tabId = match?.[2]
  if (!taskId || !tabId) return null
  const at = Date.parse(record.at)
  if (!Number.isFinite(at)) return null
  const lastLine = lastErrorLine(record.tail)
  return { taskId, tabId, exit: { code: record.code, signal: record.signal, ...(lastLine ? { lastLine } : {}) }, at }
}

/**
 * The line that explains a death: Rove's own exit banner if present, else the
 * last non-blank line. keepAlive `exec`s a login shell AFTER the banner, so an
 * engine-layer tail ends in a shell prompt, not the cause.
 */
export function lastErrorLine(tail: readonly string[]): string | undefined {
  let last: string | undefined
  for (let i = tail.length - 1; i >= 0; i--) {
    const line = (tail[i] ?? "").trim()
    if (line.length === 0) continue
    if (ENGINE_EXIT_BANNER.test(line)) return line
    last ??= line
  }
  return last
}

function exitReport(record: PtyExitRecord): { taskId?: string; detail: Record<string, unknown> } {
  const match = KEY_RE.exec(record.key)
  return {
    ...(match?.[1] ? { taskId: match[1] } : {}),
    detail: {
      key: record.key,
      ...(match?.[2] ? { tabId: match[2] } : {}),
      pid: record.pid,
      code: record.code,
      signal: record.signal,
      exitedAt: record.at,
      tail: record.tail,
    },
  }
}
