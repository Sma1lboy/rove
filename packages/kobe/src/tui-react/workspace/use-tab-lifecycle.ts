/**
 * Mount-once tab-lifecycle effects extracted from `TerminalTabs.tsx` (the
 * ~500-line cap): restart-resume verification (issue #22) and the tab
 * auto-naming poll (the tmux naming pass). Both are mount-only, forever-
 * lived effects — everything they read comes through the caller's
 * `stateRef`/`propsRef` latest-render mirrors, and every write goes
 * through the caller's `update` (which refreshes `stateRef`
 * synchronously). See the TerminalTabs file header for why refs.
 */

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

/** Cadence of the tab auto-naming pass (tmux ran its pass on the monitor tick). */
const NAMING_POLL_MS = 5000

/**
 * Session ids already spoken for by a tab, so discovery can never hand two
 * tabs one conversation — the store answers per-WORKTREE, so every tab of a
 * task sees the same list.
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
 * Restart resume verification (issue #22): rehydrated tabs' `spawned`
 * flags are up to 5s stale and must be re-verified against the real
 * transcripts before anything spawns. Returns the `hydrating` gate —
 * while true, the caller must not mount anything that spawns.
 */
export function useTabHydration(rehydrated: boolean, io: TabLifecycleIO): boolean {
  const [hydrating, setHydrating] = useState(rehydrated)
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-once verification pass; reads propsRef/stateRef for freshness.
  useEffect(() => {
    if (!rehydrated) return
    let cancelled = false
    void (async () => {
      try {
        await Promise.all(
          io.stateRef.current.tabs.map(async (tab) => {
            if (tab.kind !== "engine") return
            const vendor = tab.vendor ?? io.propsRef.current.vendor
            const worktree = io.propsRef.current.worktree
            // No recorded id: this engine mints its own and reports it
            // nowhere (kimi), so ASK ITS STORE which session this worktree
            // has. It has to happen here rather than in the naming poll —
            // `hydrating` is what holds the spawn back, and a tab that
            // respawns before its id is known opens a blank conversation,
            // which is the whole bug.
            if (!tab.sessionId) {
              const found = await discoverSessionId(vendor, worktree, claimedIds(io))
              if (cancelled || !found) return
              io.update(setTabSpawned(setTabSessionId(io.stateRef.current, tab.id, found), tab.id, true))
              return
            }
            // Ask whether the session is RECORDED, not whether kobe can
            // parse its messages: `readHistory` is empty for engines that
            // ship no message parser (kimi), so the old check reported
            // every kimi session as absent and the tab respawned blank.
            const exists = await engineSessionExists(vendor, worktree, tab.sessionId)
            if (cancelled) return
            io.update(setTabSpawned(io.stateRef.current, tab.id, exists))
          }),
        )
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

/** Auto-naming + existence tracking (the tmux naming pass), mount-only. */
export function useTabNaming(io: TabLifecycleIO): void {
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-once interval; reads propsRef/stateRef for freshness.
  useEffect(() => {
    let namingBusy = false
    const vendorOf = (tab: EngineTab): VendorId => tab.vendor ?? io.propsRef.current.vendor
    /**
     * The engine session this tab's name is read from: the id Rove pinned at
     * spawn when the vendor accepts one (claude's `--session-id`), else the
     * id the engine reports in its OWN live title — codex writes its thread
     * UUID there until the thread is named, and that thread is exactly the
     * rollout holding the first prompt. Without the second source a codex tab
     * had no session to name itself from and wore `codex N` forever.
     */
    const namingSessionId = (tab: EngineTab): string | null =>
      tab.sessionId ?? engineSessionIdFromTitle(vendorOf(tab), tab.lastTitle ?? "")
    const timer = setInterval(() => {
      if (namingBusy) return
      // A tab with no id from either authoritative source still needs one:
      // engines that mint their own and report it nowhere (kimi) can only be
      // asked after the fact. Ungated — kimi runs in an alt-screen and never
      // writes an OSC title, so any "has it started yet?" proxy read off the
      // title would never fire for the engine this exists for. Discovery is
      // safe to attempt on every tick: a worktree with no session yet simply
      // answers null and we ask again next tick.
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
            if (!found) continue
            // Recording the id is what survives the restart — `spawned`
            // rides along because a session on disk IS a conversation.
            io.update(setTabSpawned(setTabSessionId(io.stateRef.current, tab.id, found), tab.id, true))
          }
          for (const tab of candidates) {
            const sessionId = namingSessionId(tab)
            if (!sessionId) continue
            const title = await deriveTitleFromSessionId(vendorOf(tab), sessionId)
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
    return () => clearInterval(timer)
  }, [])
}
