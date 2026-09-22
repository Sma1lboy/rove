/**
 * Stat-poll trigger for file-backed daemon channels. Not fs.watch/chokidar:
 * on macOS they ride FSEvents, whose stream starts ASYNCHRONOUSLY, silently
 * dropping writes that land before it is live; even a chokidar `ready`
 * reconciliation still loses ~3% of single writes under load. Polling with a
 * baseline stamped synchronously means a caller that loads AFTER starting the
 * trigger can't miss a write. The files are small JSON/YAML, so this is a few
 * statSync calls every 200ms.
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

/** Start the poller (baseline stamped synchronously). Returns stop(), which also clears a pending debounce. */
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
