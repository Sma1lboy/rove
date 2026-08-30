/**
 * Engine deaths from the pty-host's durable exit records — TWO consumers.
 *
 * The PTY host is a separate process with no daemon-socket connection, but it
 * already persists every abnormal child exit to `pty-exits.json`
 * (`pty-exit-store.ts`). The daemon watches that file, diffs records by
 * `key + at`, and per NEW record:
 *
 *   1. fires a `session.exited` PLUGIN event (plugin-host only), and
 *   2. writes the tab's activity state to `dead` in the registry — the half
 *      that reaches the UI. Without it a killed engine (SIGTERM: no Stop, no
 *      SessionEnd, no hook of any kind) folded into idle and the tab rendered
 *      exactly like a shell that never ran anything.
 *
 * The first read after daemon start is baseline, mirroring the plugin event
 * reducer's first-snapshot rule: pre-existing corpses must not re-fire.
 */

import type { PluginHost } from "../plugins/runtime.ts"
import type { DaemonActivityRegistry } from "./activity-registry.ts"
import type { AttentionInboxStore } from "./attention-inbox.ts"
import { startFileWatchTrigger } from "./file-watch-trigger.ts"
import { defaultPtyExitsPath } from "./paths.ts"
import { type PtyExitRecord, readPtyExitRecords } from "./pty-exit-store.ts"

const DEBOUNCE_MS = 250
/** Session key shape: `taskId::tabId` (pty registry convention). */
const KEY_RE = /^(.+?)::(.+)$/

export interface PtyExitWatchOptions {
  readonly homeDir?: string
  readonly plugins: () => Pick<PluginHost, "handleUiReport"> | null
  /** Activity registry — where a death becomes the tab's live badge. */
  readonly activity?: Pick<DaemonActivityRegistry, "recordEngineDeath">
  /** Attention Inbox — where a death becomes a durable episode, so it is
   *  still findable after the badge scrolls out of view. */
  readonly inbox?: Pick<AttentionInboxStore, "recordEngineDeath">
  readonly log?: (line: string) => void
  /** Test seam. */
  readonly path?: string
}

export function startPtyExitWatch(opts: PtyExitWatchOptions): () => void {
  const path = opts.path ?? defaultPtyExitsPath(opts.homeDir)
  const seen = new Map<string, string>()

  const sweep = (): void => {
    const host = opts.plugins()
    // No host = don't mark records seen, so a fire is deferred, not lost.
    // (Unreachable today — server.ts only starts the watch with a live host —
    // but cheap insurance against a future caller.)
    if (!host) return
    const records = readPtyExitRecords(path)
    for (const record of Object.values(records)) {
      if (seen.get(record.key) === record.at) continue
      seen.set(record.key, record.at)
      host.handleUiReport({ kind: "session.exited", ...exitReport(record) })
      publishDeath(record)
    }
    // The file caps at 50 records; prune dropped keys so `seen` tracks it.
    for (const key of seen.keys()) if (!(key in records)) seen.delete(key)
  }

  /**
   * Turn a death record into the tab's `dead` activity state. Skipped when the
   * key names no tab (task-level records have nothing to badge) and when the
   * timestamp is unparseable — a death with no clock can't be arbitrated
   * against a hook claim, and guessing `now` would let an OLD record bury a
   * live engine on the next daemon start.
   */
  const publishDeath = (record: PtyExitRecord): void => {
    const registry = opts.activity
    if (!registry && !opts.inbox) return
    const match = KEY_RE.exec(record.key)
    const taskId = match?.[1]
    const tabId = match?.[2]
    if (!taskId || !tabId) return
    const at = Date.parse(record.at)
    if (!Number.isFinite(at)) return
    const lastLine = lastErrorLine(record.tail)
    const exit = { code: record.code, signal: record.signal, ...(lastLine ? { lastLine } : {}) }
    registry?.recordEngineDeath(taskId, tabId, exit, at)
    opts.inbox
      ?.recordEngineDeath(taskId, tabId, { exit }, at)
      .catch((err) => opts.log?.(`pty-exit inbox: ${String(err)}`))
  }

  // Watch BEFORE the baseline read (issue #61 pattern): the trigger's
  // baseline stamp is taken synchronously in here, so a crash record
  // written before it lands in the baseline below (predates this daemon)
  // and one written after it flips the stamp and sweeps — a record can
  // never fall between the two and lose its `session.exited` forever.
  const stop = startFileWatchTrigger({
    filePath: path,
    debounceMs: DEBOUNCE_MS,
    onTrigger: sweep,
    onError: (err) => opts.log?.(`pty-exit watch: ${String(err)}`),
  })
  // Baseline: everything already on disk predates this daemon.
  for (const record of Object.values(readPtyExitRecords(path))) seen.set(record.key, record.at)
  return stop
}

/** Last non-blank line of a recorded tail — the 403 / auth / quota text. */
export function lastErrorLine(tail: readonly string[]): string | undefined {
  for (let i = tail.length - 1; i >= 0; i--) {
    const line = (tail[i] ?? "").trim()
    if (line.length > 0) return line
  }
  return undefined
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
