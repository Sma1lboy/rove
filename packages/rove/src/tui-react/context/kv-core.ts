/**
 * Framework-free KV core (data + persistence) behind the React `KVProvider`.
 *
 *   - Hydrates synchronously from `state.json` at creation, so the first
 *     render has persisted values. Snapshot-only: another process's later
 *     writes are not seen until restart.
 *   - Writes are debounced (250ms) and dirty-key merged via `patchStateFile`:
 *     only keys this process changed reach disk, so a concurrent process's
 *     writes are never clobbered. Dirty keys survive a failed flush.
 *   - `clear()` is the one whole-file write: reset wipes everything,
 *     including other processes' keys.
 */

import { kvStatePath } from "../../env.ts"
import { createStateCell } from "../../lib/external-store"
import { loadStateFile, patchStateFile, replaceStateFile } from "../../state/store.ts"

const WRITE_DEBOUNCE_MS = 250

/** A debounced or exit flush that did not reach disk. */
export interface KvWriteFailure {
  /** The keys still unwritten — deduped, so a repeat failure on the same key is silent. */
  readonly keys: readonly string[]
  /** The file that could not be written, so the toast can name it. */
  readonly file: string
  readonly error: unknown
}

export type KvWriteErrorListener = (failure: KvWriteFailure) => void

export interface KvCore {
  /** Current in-memory snapshot (immutable per change; React-safe). */
  snapshot(): Record<string, unknown>
  /** Subscribe to snapshot changes; returns the unsubscribe function. */
  subscribe(listener: () => void): () => void
  get(key: string, defaultValue?: unknown): unknown
  /** Set + mark dirty + schedule the debounced disk flush. */
  set(key: string, value: unknown): void
  /**
   * In-memory default seeding (the `signal(name, default)` contract): sets
   * the key ONLY when currently undefined, and never marks it dirty — a
   * default must not be persisted just because it was read.
   */
  seed(key: string, value: unknown): void
  /** Synchronously flush pending dirty keys (before process.exit). */
  flush(): boolean
  /** Wipe every persisted key; false preserves the snapshot and pending edits. */
  clear(): boolean
  /**
   * Subscribe to flushes that did not reach disk. The debounced write is
   * fire-and-forget and `set()` already updated the snapshot, so without this
   * a failed write shows fine all session and reverts next launch
   * (`console.error` is invisible under the alternate screen).
   */
  onWriteError(listener: KvWriteErrorListener): () => void
}

export function createKvCore(): KvCore {
  const store = createStateCell<Record<string, unknown>>(loadStateFile(), "kv.snapshot")

  /** Keys this process has `set()` since the last successful flush. */
  const dirtyKeys = new Set<string>()
  let writeTimer: ReturnType<typeof setTimeout> | null = null
  const errorListeners = new Set<KvWriteErrorListener>()
  /**
   * Keys already reported unwritten: a read-only state dir fails every flush,
   * and would toast per keystroke. Cleared when a write lands.
   */
  const reportedKeys = new Set<string>()

  function reportWriteError(err: unknown): void {
    const fresh = [...dirtyKeys].filter((key) => !reportedKeys.has(key))
    if (fresh.length === 0) return
    for (const key of fresh) reportedKeys.add(key)
    const failure: KvWriteFailure = { keys: fresh, file: kvStatePath(), error: err }
    for (const listener of errorListeners) listener(failure)
  }

  function writeNow(label: string): boolean {
    if (dirtyKeys.size === 0) return true // nothing of ours to merge
    try {
      // A key set to `undefined` locally becomes a deletion on disk.
      const patch: Record<string, unknown> = {}
      const snap = store.get()
      for (const key of dirtyKeys) patch[key] = snap[key]
      patchStateFile(patch)
      dirtyKeys.clear()
      reportedKeys.clear()
      return true
    } catch (err) {
      // Kept for log forensics; `reportWriteError` is the on-screen half.
      console.error(`[rove] kv ${label} failed:`, err)
      reportWriteError(err)
      return false
    }
  }

  function cancelTimer(): void {
    if (writeTimer) {
      clearTimeout(writeTimer)
      writeTimer = null
    }
  }

  function scheduleWrite(): void {
    cancelTimer()
    writeTimer = setTimeout(() => {
      writeTimer = null
      writeNow("write")
    }, WRITE_DEBOUNCE_MS)
  }

  return {
    snapshot: store.get,
    subscribe: store.subscribe,
    get(key, defaultValue) {
      return store.get()[key] ?? defaultValue
    },
    set(key, value) {
      // `undefined` DELETES the key, matching disk. An enumerable `undefined`
      // makes `sweepOrphanTabsSnapshots` (walks `Object.keys`, re-runs on
      // every kv identity change) loop setState forever (React #185).
      store.update((s) => {
        if (value !== undefined) return { ...s, [key]: value }
        if (!(key in s)) return s // already absent — no snapshot churn
        const next = { ...s }
        delete next[key]
        return next
      })
      dirtyKeys.add(key)
      scheduleWrite()
    },
    seed(key, value) {
      if (store.get()[key] !== undefined) return
      store.update((s) => ({ ...s, [key]: value }))
    },
    flush() {
      cancelTimer()
      return writeNow("flush")
    },
    clear() {
      try {
        replaceStateFile({})
      } catch (err) {
        console.error("[rove] kv clear write failed:", err)
        return false
      }
      cancelTimer()
      dirtyKeys.clear()
      reportedKeys.clear()
      store.set({})
      return true
    },
    onWriteError(listener) {
      errorListeners.add(listener)
      return () => {
        errorListeners.delete(listener)
      }
    },
  }
}
