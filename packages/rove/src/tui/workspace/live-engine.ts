/**
 * Which engine is live in each tab, from the process tree: one snapshot of the
 * tab shells' subtrees per tick (`/proc` on Linux, else `ps`), walked from each
 * tab's shell pid (`engine/foreground.ts`). Not the OSC title — free text; a claude summary mentioning "codex" would relabel it.
 *
 * Enumerates the PTY registry itself so both consumers (turn-poll attach,
 * tab-strip titles) share ONE probe instead of racing reconciles.
 */

import { type PsSnapshot, foregroundEngineIn, parsePsSnapshot } from "../../engine/foreground"
import { descendantSnapshot } from "../../engine/proc-descendants"
import type { VendorId } from "../../types/vendor"
import type { TaskPtyLike } from "../panes/terminal/pty-types"
import { getDefaultPtyRegistry } from "../panes/terminal/registry"

/** Live PTYs to probe — injectable so tests drive a fake set. */
type PtyEntries = () => readonly (readonly [string, TaskPtyLike])[]

export interface LiveEngineStore {
  /** Live vendor for a ptyKey, or null when it runs no engine. */
  get(key: string): VendorId | null
  /**
   * Vendor = that engine runs under the shell now; null = the last probe
   * walked the shell and found no engine (e.g. ctrl+C'd to the prompt);
   * undefined = couldn't look (no PTY/pid yet, ps failed) → callers use the
   * recorded identity. The split lets a creation pin cover the spawn window
   * without resurrecting a dead engine's name.
   */
  resolve(key: string): VendorId | null | undefined
  /**
   * Extra ptyKey → shell pid pairs from the pty host's `pty.list`, for hosted
   * tabs this process never attached. Sourced from the host inventory, so a
   * foreign terminal can't be probed. The registry's pid wins on overlap.
   */
  setAuxPids(pids: ReadonlyMap<string, number>): void
  /** Subscribe to identity changes (fires when any key's vendor moved). */
  subscribe(listener: () => void): () => void
  /** Run one probe pass now — the interval calls this; tests await it. */
  probe(): Promise<void>
  dispose(): void
}

export type LiveEngineOpts = {
  entries?: PtyEntries
  snapshot?: PsSnapshot
  /** Engines start and stop on human timescales — one probe every 2s. */
  intervalMs?: number
  /**
   * OFF-edge debounce: consecutive engine-free walks before a lit identity
   * goes dark (engines vanish briefly mid-restart, e.g. claude after /login).
   * ON is immediate: a vendor needs positive argv evidence.
   */
  releaseAfterMisses?: number
  /** Longest a quiet tick may skip the walk; see `walkIsCurrent`. */
  maxQuietSkipMs?: number
  now?: () => number
}

export function createLiveEngines(opts: LiveEngineOpts = {}): LiveEngineStore {
  const entries = opts.entries ?? (() => getDefaultPtyRegistry().entries())
  const snapshot = opts.snapshot ?? descendantSnapshot
  const releaseAfterMisses = Math.max(1, opts.releaseAfterMisses ?? 2)
  const maxQuietSkipMs = opts.maxQuietSkipMs ?? 10_000
  const now = opts.now ?? Date.now
  const vendors = new Map<string, VendorId>()
  /** Consecutive engine-free walks per lit key — the OFF-edge debounce. */
  const misses = new Map<string, number>()
  /** Keys the last successful probe walked: present without vendor = null, absent = undefined in resolve(). */
  const answered = new Set<string>()
  /** Hosted-session pids the local registry can't see — see setAuxPids. */
  let auxPids: ReadonlyMap<string, number> = new Map()
  const listeners = new Set<() => void>()
  let disposed = false
  /** The last successful walk: when, which pids, and each PTY's output stamp before it. */
  let lastWalk: { at: number; pids: Map<string, number>; out: Map<string, number | null> } | null = null

  const emit = (): void => {
    for (const l of listeners) l()
  }

  /** Output stamp per registry key; null when that PTY can't report one. */
  const outputStamps = (): Map<string, number | null> => {
    const out = new Map<string, number | null>()
    for (const [key, pty] of entries()) out.set(key, pty.lastOutputAtMs ? pty.lastOutputAtMs() : null)
    return out
  }

  /** Every key to walk and its pid; `live` also holds keys with no walkable pid yet. */
  const collectPids = (): { pids: Map<string, number>; live: Set<string> } => {
    const pids = new Map<string, number>()
    const live = new Set<string>()
    for (const [key, pid] of auxPids) {
      live.add(key)
      pids.set(key, pid)
    }
    for (const [key, pty] of entries()) {
      live.add(key)
      const pid = pty.shellPid ?? null
      // Registry pid outranks the host's, but a null (unspawned) one must not erase it.
      if (pid !== null) pids.set(key, pid)
    }
    return { pids, live }
  }

  /**
   * An engine that starts or exits under a shell prints, so a walk is still
   * current while the same pids printed nothing since. Keys with no output
   * stamp (aux-only hosted tabs, stamp-less backends) and a pending OFF-edge
   * miss always re-walk; `maxQuietSkipMs` bounds a silent start.
   */
  const walkIsCurrent = (): boolean => {
    if (!lastWalk || misses.size > 0 || now() - lastWalk.at >= maxQuietSkipMs) return false
    const { pids } = collectPids()
    if (pids.size !== lastWalk.pids.size) return false
    for (const [key, pid] of pids) if (lastWalk.pids.get(key) !== pid) return false
    const registry = new Map(entries())
    for (const key of pids.keys()) {
      const pty = registry.get(key)
      if (!pty?.lastOutputAtMs || pty.lastOutputAtMs() !== lastWalk.out.get(key)) return false
    }
    return true
  }

  const store: LiveEngineStore = {
    async probe() {
      if (disposed) return
      const { pids, live } = collectPids()
      let changed = false
      // No walkable pid → no identity and no answer ("can't look", not "empty").
      for (const key of [...vendors.keys()]) {
        if (live.has(key) && pids.has(key)) continue
        vendors.delete(key)
        misses.delete(key)
        changed = true
      }
      for (const key of [...answered]) {
        if (live.has(key) && pids.has(key)) continue
        answered.delete(key)
      }
      const out = outputStamps()
      if (pids.size > 0) {
        let rows: ReturnType<typeof parsePsSnapshot>
        try {
          rows = parsePsSnapshot(await snapshot([...pids.values()]))
        } catch {
          lastWalk = null
          if (changed) emit()
          return // an identity we can't read leaves the last one standing
        }
        if (disposed) return
        lastWalk = { at: now(), pids, out }
        for (const [key, pid] of pids) {
          const vendor = foregroundEngineIn(rows, pid)?.vendor ?? null
          answered.add(key)
          const prev = vendors.get(key) ?? null
          if (vendor) {
            misses.delete(key)
            if (prev === vendor) continue
            vendors.set(key, vendor)
            changed = true
            continue
          }
          if (prev === null) continue
          const count = (misses.get(key) ?? 0) + 1
          if (count < releaseAfterMisses) {
            misses.set(key, count)
            continue
          }
          misses.delete(key)
          vendors.delete(key)
          changed = true
        }
      }
      if (changed) emit()
    },
    get(key) {
      return vendors.get(key) ?? null
    },
    resolve(key) {
      const vendor = vendors.get(key)
      if (vendor) return vendor
      return answered.has(key) ? null : undefined
    },
    setAuxPids(pids) {
      auxPids = pids
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose() {
      disposed = true
      listeners.clear()
      vendors.clear()
      misses.clear()
      answered.clear()
      clearInterval(handle)
    },
  }

  const handle = setInterval(() => {
    if (!walkIsCurrent()) void store.probe()
  }, opts.intervalMs ?? 2000)
  handle.unref?.()

  return store
}

/** App-wide store — both consumers read this one so they share a probe. */
let defaultStore: LiveEngineStore | null = null

export function getDefaultLiveEngines(): LiveEngineStore {
  if (!defaultStore) defaultStore = createLiveEngines()
  return defaultStore
}
