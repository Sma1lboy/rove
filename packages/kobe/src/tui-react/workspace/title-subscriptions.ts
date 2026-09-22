/**
 * The ONE "ptyKey → live foreground-process title" reconciler for workspace
 * terminal surfaces. Two load-bearing properties:
 *
 *   - INSTANCE-compared, not `has(key)`: release + respawn at the same key must
 *     re-subscribe, or the leaf freezes on the dead PTY's last title.
 *   - keyed on the GLOBALLY-UNIQUE registry ptyKey (`splitLeafPtyKey(tabKey,
 *     id)` / `soloKey(...)`), not the bare leaf id: TerminalSplit has no React
 *     key and survives tab switches while every tab starts at `leaf-1`, so bare
 *     ids bleed one tab's title onto the next.
 *
 * The store keeps titles RAW (the OSC stream is the label). Collapsing to the
 * binary via the live-engine vendor would drop the engine's live status line
 * and flicker, since the ps-walk probe transiently loses the vendor mid-turn.
 * Render projections (here and use-turn-polls) strip only the leading status
 * decoration (`terminalTitle.statusPrefixes`), since Rove draws that state in
 * its own glyph column.
 *
 * {@link createTitleSubscriptions} is plain closures over Maps (vitest-able).
 * Callers own the tick driving `reconcile()`: PTYs spawn after mount, so attach retries.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { stripEngineStatusPrefix } from "../../engine/registry"
import type { TaskPtyLike } from "../../tui/panes/terminal/pty-types"
import { getDefaultPtyRegistry } from "../../tui/panes/terminal/registry"
import { getDefaultLiveEngines } from "../../tui/workspace/live-engine"
import { useLatest } from "../lib/use-latest"

/** Injectable so tests drive a fake PTY set. */
export type PtyLookup = (key: string) => TaskPtyLike | null

export interface TitleSubscriptions {
  /**
   * Reconcile to exactly `ptyKeys`; a key whose PTY instance changed
   * re-subscribes. True when any title changed.
   */
  reconcile(ptyKeys: Iterable<string>): boolean
  /** Undefined until the PTY reports one. */
  get(key: string): string | undefined
  /** Fires on any reconcile that moved a title. */
  subscribe(listener: () => void): () => void
  dispose(): void
}

export function createTitleSubscriptions(
  lookup: PtyLookup = getDefaultPtyRegistry().get.bind(getDefaultPtyRegistry()),
): TitleSubscriptions {
  /** `title` is undefined until the PTY reports one (see the seeding note below). */
  type Entry = { pty: TaskPtyLike; unsub: () => void; title: string | undefined }
  const subs = new Map<string, Entry>()
  const listeners = new Set<() => void>()

  const emit = (): void => {
    for (const l of listeners) l()
  }

  return {
    reconcile(ptyKeys) {
      const wanted = new Set(ptyKeys)
      let changed = false

      // Unwanted, or the instance changed: the dead PTY's title must not linger.
      for (const [key, sub] of subs) {
        const cur = wanted.has(key) ? lookup(key) : null
        if (cur === sub.pty) continue
        sub.unsub()
        subs.delete(key)
        changed = true
      }

      // Lazy: absent PTYs (spawned after mount) retry next tick.
      for (const key of wanted) {
        if (subs.has(key)) continue
        const pty = lookup(key)
        if (!pty) continue
        // onTitleChange replays the current title synchronously when there is
        // one. Until then `undefined`, NOT `""`: an empty `get()` reads as
        // "title is empty" and the host would record it over the tab's real
        // `lastTitle` (use-tab-turn-state), wiping the name to the vendor default.
        const entry: Entry = { pty, unsub: () => {}, title: undefined }
        entry.unsub = pty.onTitleChange((raw) => {
          if (entry.title === raw) return
          entry.title = raw
          emit()
        })
        subs.set(key, entry)
        changed = true
      }

      return changed
    },
    get(key) {
      return subs.get(key)?.title
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose() {
      for (const sub of subs.values()) sub.unsub()
      subs.clear()
      listeners.clear()
    },
  }
}

const TITLE_ATTACH_MS = 2000

/**
 * React binding: one store per component, reconciled on `ptyKeys` change, on
 * a 2s lazy-attach tick, and on title pushes (called directly, so a no-change
 * tick renders nothing). `ptyKeys` maps a caller id (leaf/tab id) to its
 * GLOBALLY-UNIQUE ptyKey; the returned map is keyed by that id. An unchanged
 * title set returns the SAME Map.
 */
export function useTitleSubscriptions(ptyKeys: ReadonlyMap<string, string>): ReadonlyMap<string, string> {
  const storeRef = useRef<TitleSubscriptions | null>(null)
  if (storeRef.current === null) storeRef.current = createTitleSubscriptions()
  const store = storeRef.current
  const [titles, setTitles] = useState<ReadonlyMap<string, string>>(new Map())
  const ptyKeysRef = useLatest(ptyKeys)

  const reconcile = useCallback(() => {
    const keys = ptyKeysRef.current
    store.reconcile(keys.values())
    const liveEngines = getDefaultLiveEngines()
    setTitles((prev) => {
      const next = new Map<string, string>()
      for (const [id, key] of keys) {
        const title = store.get(key)
        if (title === undefined) continue
        // Same strip as use-turn-polls: Rove's glyph column is the one place
        // turn state is drawn.
        next.set(id, stripEngineStatusPrefix(title, liveEngines.resolve(key)))
      }
      if (next.size === prev.size && [...next].every(([id, v]) => prev.get(id) === v)) return prev
      return next
    })
  }, [store])

  useEffect(() => {
    const timer = setInterval(reconcile, TITLE_ATTACH_MS)
    return () => clearInterval(timer)
  }, [reconcile])

  // Reconcile when the requested key set changes (and once on mount).
  useEffect(() => {
    void ptyKeys
    reconcile()
  }, [ptyKeys, reconcile])

  // Title pushes re-project, deferred one microtask (coalesced): a fresh
  // subscription seeds SYNCHRONOUSLY inside the store's reconcile loop, which
  // must never be re-entered.
  useEffect(() => {
    let active = true
    let scheduled = false
    const unsub = store.subscribe(() => {
      if (scheduled) return
      scheduled = true
      queueMicrotask(() => {
        scheduled = false
        if (active) reconcile()
      })
    })
    return () => {
      active = false
      unsub()
    }
  }, [store, reconcile])

  useEffect(() => () => store.dispose(), [store])

  return titles
}
