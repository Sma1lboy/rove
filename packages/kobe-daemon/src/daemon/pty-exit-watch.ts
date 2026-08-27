/**
 * `session.exited` plugin events from the pty-host's death records.
 *
 * The PTY host is a separate process with no daemon-socket connection, but it
 * already persists every abnormal child exit to `pty-exits.json`
 * (`pty-exit-store.ts`). The daemon watches that file, diffs records by
 * `key + at`, and fires one `session.exited` per NEW record — the only signal
 * that exists when an engine CRASHES (its own `session.end` hook never runs).
 *
 * The first read after daemon start is baseline, mirroring the plugin event
 * reducer's first-snapshot rule: pre-existing corpses must not re-fire.
 */

import type { PluginHost } from "../plugins/runtime.ts"
import { startFileWatchTrigger } from "./file-watch-trigger.ts"
import { defaultPtyExitsPath } from "./paths.ts"
import { type PtyExitRecord, readPtyExitRecords } from "./pty-exit-store.ts"

const DEBOUNCE_MS = 250
/** Session key shape: `taskId::tabId` (pty registry convention). */
const KEY_RE = /^(.+?)::(.+)$/

export interface PtyExitWatchOptions {
  readonly homeDir?: string
  readonly plugins: () => Pick<PluginHost, "handleUiReport"> | null
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
    }
    // The file caps at 50 records; prune dropped keys so `seen` tracks it.
    for (const key of seen.keys()) if (!(key in records)) seen.delete(key)
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
