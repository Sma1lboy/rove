/**
 * Shared stat-poll trigger for daemon channels backed by files.
 *
 * State-like files in kobe are commonly written with tmp+rename, and every
 * fs-event watcher on macOS (fs.watch, chokidar) rides FSEvents, whose
 * stream starts ASYNCHRONOUSLY: a write landing after the watcher is
 * created but before the stream is live is dropped forever, with no signal
 * (issue #61 — same failure the plugin registry hit, fixed the same way in
 * PR #590). A chokidar `ready` reconciliation narrowed that window but did
 * not close it: writes landing between the ready check and stream-live
 * still probed at ~3% single-write loss under load. Stat-polling closes it
 * constructively — the baseline stamp is taken synchronously before this
 * function returns, so a caller that does its first load AFTER starting
 * the trigger can never miss a write: earlier writes are seen by that
 * load, later ones flip a stamp. The watched files are single small
 * JSON/YAML files, so the poll is a few statSync calls every 200ms.
 */

import { statSync } from "node:fs"
import { basename, dirname, join } from "node:path"

/** Stamp-poll cadence; trigger latency is this + the caller's debounce. */
const POLL_MS = 200

export interface FileWatchTriggerOptions {
  /** File to watch (stamped by basename inside its parent directory). */
  readonly filePath: string
  /** Additional basenames that should count as the same watched file. */
  readonly matchBasenames?: readonly string[]
  /** Debounce between a detected change and `onTrigger`. `<= 0` disables. */
  readonly debounceMs: number
  /** Called after a debounced detected change. */
  readonly onTrigger: () => void
  /** Best-effort error sink; trigger errors are never thrown. */
  readonly onError: (err: unknown) => void
}

/**
 * Start the poller. The baseline stamps are taken synchronously, so callers
 * that load AFTER this returns cannot lose a concurrent write. The returned
 * stop function clears the poll interval and any pending debounce timer.
 */
export function startFileWatchTrigger(opts: FileWatchTriggerOptions): () => void {
  if (opts.debounceMs <= 0) return () => {}

  const dir = dirname(opts.filePath)
  const names = [...new Set([basename(opts.filePath), ...(opts.matchBasenames ?? [])])]

  let timer: ReturnType<typeof setTimeout> | null = null

  const trigger = (): void => {
    try {
      opts.onTrigger()
    } catch (err) {
      opts.onError(err)
    }
  }

  const schedule = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      trigger()
    }, opts.debounceMs)
    timer.unref?.()
  }

  /** mtime(ns) + size + inode, or "absent" — flips on write, rename, delete. */
  const stampOf = (name: string): string => {
    try {
      const s = statSync(join(dir, name), { bigint: true })
      return `${s.mtimeNs}:${s.size}:${s.ino}`
    } catch {
      return "absent"
    }
  }

  const stamps = new Map<string, string>()
  for (const name of names) stamps.set(name, stampOf(name))

  const poll = setInterval(() => {
    for (const name of names) {
      const stamp = stampOf(name)
      if (stamp === stamps.get(name)) continue
      stamps.set(name, stamp)
      schedule()
    }
  }, POLL_MS)
  poll.unref?.()

  return () => {
    clearInterval(poll)
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }
}
