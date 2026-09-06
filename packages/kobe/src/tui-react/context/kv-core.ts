/**
 * Framework-free KV core — the data + persistence half of the KV store,
 * consumed by the React `KVProvider` and unit-testable under vitest
 * (no @opentui).
 *
 * Semantics:
 *   - Synchronous snapshot hydration from `state.json` at creation, so the
 *     first render already sees persisted values (no default flash).
 *     Snapshot-only reads — a key another process writes later is not
 *     picked up until restart.
 *   - Writes are debounced (250ms) and DIRTY-KEY MERGED via
 *     `patchStateFile`: only keys THIS process changed since its last
 *     successful flush reach disk, so a concurrent kobe process's writes
 *     are never clobbered by a whole-snapshot write-back (the classic
 *     lost-update bug). Dirty keys survive a failed flush and retry on the
 *     next one.
 *   - `clear()` is the one legitimate whole-file write
 *     (`replaceStateFile({})`): "reset UI state" means wipe EVERYTHING,
 *     including keys other processes wrote after we loaded.
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
   * Subscribe to flushes that did not reach disk; returns the unsubscribe.
   *
   * The debounced write is fire-and-forget — nothing awaits it and `set()`
   * has already updated the snapshot, so a rejected write used to be
   * invisible: the UI showed the new theme/toggle/width all session and
   * silently reverted at the next launch. `console.error` alone does not
   * count as surfacing under an alternate screen (see
   * `workspace/use-host-notifiers.ts`), so the on-screen half needs a sink.
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
   * Keys already reported as unwritten. A read-only state dir fails EVERY
   * 250ms flush, and dirty keys survive a failed write, so without this the
   * same key raises a toast on every keystroke that touches it. Cleared on
   * the next write that lands, so a failure that comes back is reported again.
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
      // Read-merge-write: only OUR dirty keys are applied onto a fresh
      // read of the file. A key set to `undefined` locally serializes as
      // a deletion (patchStateFile deletes explicit-undefined entries).
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
      // `undefined` DELETES: the key must leave the snapshot, not sit in it
      // as an enumerable `undefined` — `sweepOrphanTabsSnapshots` walks
      // `Object.keys` and re-deletes anything still present, and its effect
      // re-runs on every kv identity change, so a spread-back key turns one
      // sweep into an infinite setState loop (React #185). Disk already has
      // delete semantics (patchStateFile drops explicit-undefined entries);
      // this aligns the in-memory snapshot with it.
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
