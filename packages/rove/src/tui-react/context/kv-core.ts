/**
 * Framework-free KV core (data + persistence) behind the React `KVProvider`.
 *
 *   - Hydrates synchronously from `state.json` at creation, so the first
 *     render has persisted values, then follows the daemon's `state` push
 *     (`follow`), so another process's writes and hand edits show up live.
 *   - Writes are debounced (250ms) and dirty-key merged via `patchStateFile`:
 *     only keys this process changed reach disk, so a concurrent process's
 *     writes are never clobbered. Dirty keys survive a failed flush.
 *   - `clear()` is the one whole-file write: reset wipes everything,
 *     including other processes' keys.
 */

import { logClientError } from "@sma1lboy/rove-daemon/client/client-log"
import { kvStatePath } from "../../env.ts"
import { createStateCell } from "../../lib/external-store"
import { loadStateFile, patchStateFile, readStateFileStrict, replaceStateFile } from "../../state/store.ts"
import { SIDEBAR_COLLAPSED_KEY, SIDEBAR_WIDTH_KEY } from "../../state/sidebar-collapsed.ts"
import { TERMINAL_TABS_PREFIX } from "../../state/tabs-persistence.ts"
import { ZEN_ACTIVE_KEY } from "../../state/zen.ts"

const WRITE_DEBOUNCE_MS = 250

/** Per-window layout: another window folding its rail must not fold this one. The file keeps the last write, for the next launch. */
const PER_WINDOW_KEYS: ReadonlySet<string> = new Set([SIDEBAR_COLLAPSED_KEY, SIDEBAR_WIDTH_KEY, ZEN_ACTIVE_KEY])

/** A debounced or exit flush that did not reach disk. */
export interface KvWriteFailure {
  /** The keys still unwritten — deduped, so a repeat failure on the same key is silent. */
  readonly keys: readonly string[]
  /** The file that could not be written, so the toast can name it. */
  readonly file: string
  readonly error: unknown
}

export type KvWriteErrorListener = (failure: KvWriteFailure) => void

/** `changed` counts keys whose value differs from the snapshot before the reload. */
export type KvReloadResult =
  | { readonly ok: true; readonly changed: number }
  | { readonly ok: false; readonly error: unknown }

export interface KvCore {
  /** Current in-memory snapshot (immutable per change; React-safe). */
  snapshot(): Record<string, unknown>
  /** Subscribe to snapshot changes; returns the unsubscribe function. */
  subscribe(listener: () => void): () => void
  get(key: string, defaultValue?: unknown): unknown
  /** Set + mark dirty + schedule the debounced disk flush. */
  set(key: string, value: unknown): void
  /**
   * `set` without a new snapshot: `get` and disk see it, subscribers don't
   * re-render. For write-often keys no render reads (the inbox visit log).
   */
  setQuiet(key: string, value: unknown): void
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
   * Re-read `state.json` into the snapshot. Pending keys flush first; any that
   * still can't reach disk keep their local value. An unreadable or invalid
   * file changes nothing and is left in place. Flushes retain pending keys
   * until the file is repaired.
   */
  reload(): KvReloadResult
  /**
   * Adopt the daemon's `state` push (every key but `terminalTabs.*`), the
   * way `reload` adopts the file: unflushed local keys win until they land.
   */
  follow(shared: Readonly<Record<string, unknown>>): void
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
  /** `setQuiet` values, read over the snapshot until the next `set` of the key. */
  const quiet = new Map<string, unknown>()
  /** `seed()` defaults, restored by `reload()` for keys the file doesn't carry. */
  const seeded = new Map<string, unknown>()
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
      for (const key of dirtyKeys) patch[key] = quiet.has(key) ? quiet.get(key) : snap[key]
      patchStateFile(patch, "strict")
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

  /** Adopt `fresh` as the snapshot, keeping this process's unflushed keys and seeded defaults. Returns the keys that moved. */
  function merge(fresh: Record<string, unknown>): number {
    const before = store.get()
    const next: Record<string, unknown> = { ...fresh }
    for (const [key, value] of seeded) if (next[key] === undefined) next[key] = value
    for (const key of dirtyKeys) {
      if (before[key] === undefined) delete next[key]
      else next[key] = before[key]
    }
    for (const key of [...quiet.keys()]) if (!dirtyKeys.has(key)) quiet.delete(key)
    if (dirtyKeys.size > 0) scheduleWrite()
    let changed = 0
    for (const key of new Set([...Object.keys(before), ...Object.keys(next)])) {
      if (JSON.stringify(before[key]) !== JSON.stringify(next[key])) changed++
    }
    if (changed > 0) store.set(next)
    return changed
  }

  return {
    snapshot: store.get,
    subscribe: store.subscribe,
    get(key, defaultValue) {
      return (quiet.has(key) ? quiet.get(key) : store.get()[key]) ?? defaultValue
    },
    set(key, value) {
      // The daemon is the only writer of terminal tabs (`tabs-store.ts`); a whole-key write from
      // here would be the multi-writer race it exists to end.
      if (key.startsWith(TERMINAL_TABS_PREFIX)) {
        logClientError("kv", new Error(`refused a local write of ${key}: tabs go through the daemon`))
        return
      }
      quiet.delete(key)
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
    setQuiet(key, value) {
      quiet.set(key, value)
      dirtyKeys.add(key)
      scheduleWrite()
    },
    seed(key, value) {
      if (!seeded.has(key)) seeded.set(key, value)
      if (quiet.has(key) || store.get()[key] !== undefined) return
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
      quiet.clear()
      store.set({})
      return true
    },
    reload() {
      try {
        // Validate before flushing: a flush through a corrupt file would
        // move the user's half-finished edit aside.
        readStateFileStrict()
        cancelTimer()
        writeNow("reload flush")
        return { ok: true, changed: merge(readStateFileStrict()) }
      } catch (error) {
        return { ok: false, error }
      }
    },
    follow(shared) {
      // The push leaves out the daemon-owned tab keys; keep ours.
      const next: Record<string, unknown> = { ...shared }
      for (const key of PER_WINDOW_KEYS) delete next[key]
      for (const [key, value] of Object.entries(store.get())) {
        if (key.startsWith(TERMINAL_TABS_PREFIX) || PER_WINDOW_KEYS.has(key)) next[key] = value
      }
      merge(next)
    },
    onWriteError(listener) {
      errorListeners.add(listener)
      return () => {
        errorListeners.delete(listener)
      }
    },
  }
}
