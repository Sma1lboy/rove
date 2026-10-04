/**
 * Mount-once, forever-lived tab effects (grouped with `use-tab-handoffs.ts` by
 * lifetime): restart-resume verification and auto-naming. Reads go through
 * the caller's `stateRef`/`propsRef` mirrors, writes through `update` (which
 * refreshes `stateRef` synchronously). See TerminalTabs' header for why refs.
 */

import { protocolEntry } from "@/engine/engine-presets"
import { engineSessionIdFromTitle } from "@/engine/registry"
import { discoverSessionId, engineSessionExists } from "@/engine/session-discovery"
import { deriveTitleFromSessionId } from "@/monitor/auto-title"
import type { VendorId } from "@/types/vendor"
import { useEffect, useState } from "react"
import {
  type EngineTab,
  type TabsState,
  setTabAutoTitle,
  setTabSessionId,
  setTabSpawned,
} from "../../tui/workspace/terminal-tabs-core"

const NAMING_POLL_MS = 5000

/**
 * Ids already claimed by a tab, so discovery never hands two tabs one
 * conversation (the store answers per-WORKTREE, so every tab sees one list).
 */
function claimedIds(io: TabLifecycleIO): Set<string> {
  return new Set(io.stateRef.current.tabs.flatMap((t) => (t.kind === "engine" && t.sessionId ? [t.sessionId] : [])))
}

export interface TabLifecycleIO {
  readonly stateRef: { readonly current: TabsState }
  readonly propsRef: { readonly current: { readonly vendor: VendorId; readonly worktree: string } }
  readonly update: (next: TabsState) => void
}

/**
 * Rehydrated `spawned` flags are up to 5s stale and must be re-verified against
 * real transcripts. While the returned `hydrating` is true, the caller must
 * not mount anything that spawns.
 */
export function useTabHydration(rehydrated: boolean, io: TabLifecycleIO): boolean {
  const [hydrating, setHydrating] = useState(rehydrated)
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-once verification pass; reads propsRef/stateRef for freshness.
  useEffect(() => {
    if (!rehydrated) return
    let cancelled = false
    void (async () => {
      try {
        const engines = io.stateRef.current.tabs.filter((tab): tab is EngineTab => tab.kind === "engine")
        const worktree = io.propsRef.current.worktree
        const vendorOfTab = (tab: EngineTab): VendorId => tab.vendor ?? io.propsRef.current.vendor

        // SEQUENTIALLY, re-reading the claim set each time (as `useTabNaming`
        // does): a claim exists only after `io.update` writes the sessionId, so
        // concurrent discovery hands every tab the SAME newest id and two live
        // engines write one transcript, the collision `session-identity.ts`
        // claim-tracking exists to prevent.
        for (const tab of engines) {
          const vendor = vendorOfTab(tab)
          if (tab.sessionId) {
            const exists = await engineSessionExists(vendor, worktree, tab.sessionId)
            if (cancelled) return
            io.update(setTabSpawned(io.stateRef.current, tab.id, exists))
            // A caller-pinned id may belong to a fresh, still-empty tab;
            // engine-generated ids must name a recorded conversation.
            if (exists || protocolEntry(vendor).sessionIdentity?.pinFlag) continue
          }
          // No id and the engine reports none (kimi): ASK ITS STORE. Must be
          // here, not in the naming poll: `hydrating` holds the spawn, and a
          // tab respawning before its id is known opens a blank conversation.
          const found = await discoverSessionId(vendor, worktree, claimedIds(io))
          if (cancelled) return
          if (!found) continue
          io.update(setTabSpawned(setTabSessionId(io.stateRef.current, tab.id, found), tab.id, true))
        }
      } finally {
        if (!cancelled) setHydrating(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])
  return hydrating
}

/** Auto-naming + existence tracking, mount-only. */
export function useTabNaming(io: TabLifecycleIO): void {
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-once interval; reads propsRef/stateRef for freshness.
  useEffect(() => {
    let namingBusy = false
    let cancelled = false
    const vendorOf = (tab: EngineTab): VendorId => tab.vendor ?? io.propsRef.current.vendor
    /**
     * Rove's pinned id (claude's `--session-id`), else the id the engine puts
     * in its OWN live title: codex writes its thread UUID there until the
     * thread is named, and without it a codex tab stays `codex N` forever.
     */
    const namingSessionId = (tab: EngineTab): string | null =>
      tab.sessionId ?? engineSessionIdFromTitle(vendorOf(tab), tab.lastTitle ?? "")
    const timer = setInterval(() => {
      if (namingBusy) return
      // Engines that mint an id and report it nowhere (kimi) can only be asked
      // after the fact. Ungated: kimi runs alt-screen with no OSC title, so any
      // title-based "started yet?" proxy never fires. A worktree with no
      // session just answers null until next tick.
      const undiscovered = io.stateRef.current.tabs.filter(
        (tab): tab is EngineTab => tab.kind === "engine" && !namingSessionId(tab),
      )
      const candidates = io.stateRef.current.tabs.filter(
        (tab): tab is EngineTab =>
          tab.kind === "engine" && !!namingSessionId(tab) && (!tab.spawned || (!tab.title && !tab.autoTitle)),
      )
      if (candidates.length === 0 && undiscovered.length === 0) return
      namingBusy = true
      void (async () => {
        try {
          for (const tab of undiscovered) {
            const found = await discoverSessionId(vendorOf(tab), io.propsRef.current.worktree, claimedIds(io))
            if (cancelled) return
            if (!found) continue
            // The id is what survives restart; `spawned` rides along because
            // a session on disk IS a conversation.
            io.update(setTabSpawned(setTabSessionId(io.stateRef.current, tab.id, found), tab.id, true))
          }
          for (const tab of candidates) {
            const sessionId = namingSessionId(tab)
            if (!sessionId) continue
            const title = await deriveTitleFromSessionId(vendorOf(tab), sessionId)
            if (cancelled) return
            if (!title) continue
            let next = setTabSpawned(io.stateRef.current, tab.id, true)
            if (!tab.title && !tab.autoTitle) next = setTabAutoTitle(next, tab.id, title)
            io.update(next)
          }
        } finally {
          namingBusy = false
        }
      })()
    }, NAMING_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])
}
