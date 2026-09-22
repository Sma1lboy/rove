/** Per-tab PTY title subscriptions and session-scoped turn polling.
 * Hook-confirmed session identities select exact transcripts; this hook never
 * consumes worktree-wide activity. PTY identity changes dispose the old poll.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { engineEntry, stripEngineStatusPrefix } from "../../engine/registry"
import type { ChatTabTurnState } from "../../engine/turn-detector"
import { startTurnStatusPoll } from "../../tui/ops/activity-monitor"
import { getDefaultPtyRegistry } from "../../tui/panes/terminal/registry"
import { getDefaultLiveEngines } from "../../tui/workspace/live-engine"
import type { TabsState } from "../../tui/workspace/terminal-tabs-core"
import type { HookTabState } from "../../tui/workspace/turn-state-merge"
import { soloKey, targetFor } from "../../tui/workspace/turn-target"
import type { VendorId } from "../../types/vendor"
import { useLatest } from "../lib/use-latest"
import { type TitleSubscriptions, createTitleSubscriptions } from "./title-subscriptions"

/** Lazy attach retry: a tab's PTY spawns after mount. */
const TURN_POLL_ATTACH_MS = 2000

export function useTurnPolls(deps: {
  taskId: string
  worktree: string
  /** Task-level engine — the fallback for tabs without a pinned vendor. */
  vendor: VendorId
  state: TabsState
  hookTabStates?: ReadonlyMap<string, HookTabState>
}): {
  turnStates: ReadonlyMap<string, ChatTabTurnState>
  /** tabId → live OSC title minus the engine's status prefix; the tab strip's dynamic default names. */
  liveTitles: ReadonlyMap<string, string>
  /** tabId → UNSTRIPPED OSC title, for the ESC-interrupt observer's working→rest flip. */
  rawTitles: ReadonlyMap<string, string>
  /** tabId → the vendor the attached detector tracks, whether Rove-launched or
   *  user-typed; the strip's "does this process own its status" input. */
  turnVendors: ReadonlyMap<string, VendorId>
} {
  const [turnStates, setTurnStates] = useState<ReadonlyMap<string, ChatTabTurnState>>(new Map())
  const [liveTitles, setLiveTitles] = useState<ReadonlyMap<string, string>>(new Map())
  const [rawTitles, setRawTitles] = useState<ReadonlyMap<string, string>>(new Map())
  const [turnVendors, setTurnVendors] = useState<ReadonlyMap<string, VendorId>>(new Map())
  const turnPollsRef = useRef(new Map<string, { dispose: () => void; vendor: VendorId; key: string }>())
  /** Instance-compared (see title-subscriptions.ts): a dead claude's stale
   *  title must not keep a detector attached to the fresh shell. */
  const titleStoreRef = useRef<TitleSubscriptions | null>(null)
  if (titleStoreRef.current === null) titleStoreRef.current = createTitleSubscriptions()

  // Latest-render mirrors for detector closures created once per attach.
  const hookTabStatesRef = useLatest(deps.hookTabStates)
  const stateRef = useLatest(deps.state)
  const taskIdRef = useLatest(deps.taskId)
  const vendorRef = useLatest(deps.vendor)

  // Stable, so the tick and store pushes call it directly; identity-stable
  // setState guards keep a no-change run render-free.
  const reconcile = useCallback(() => {
    const reg = getDefaultPtyRegistry()
    const attached = new Set<string>()
    const turnPolls = turnPollsRef.current
    const titleStore = titleStoreRef.current
    const liveEngines = getDefaultLiveEngines()
    if (!titleStore) return
    const taskId = taskIdRef.current
    const state = stateRef.current

    // Pass 1: title subscriptions on every tab's solo PTY.
    const soloKeys = new Map<string, string>() // ptyKey → tabId
    for (const tab of state.tabs) {
      const key = soloKey(taskId, tab)
      if (key) soloKeys.set(key, tab.id)
    }
    titleStore.reconcile(soloKeys.keys())
    // UNSTRIPPED titles for the ESC-interrupt observer, which reads the
    // working → resting flip (`engineTitleTurnHint`) the strip below erases.
    setRawTitles((prev) => {
      const next = new Map<string, string>()
      for (const [key, tabId] of soloKeys) {
        const title = titleStore.get(key)
        if (title !== undefined) next.set(tabId, title)
      }
      if (next.size === prev.size && [...next].every(([id, v]) => prev.get(id) === v)) return prev
      return next
    })
    // tabId → title, identity-stable.
    setLiveTitles((prev) => {
      const next = new Map<string, string>()
      for (const [key, tabId] of soloKeys) {
        const title = titleStore.get(key)
        if (title === undefined) continue
        // Strip the status decoration HERE, where the raw OSC title enters the
        // app: the strip, the tree and the `lastTitle` recorder all get the bare
        // name, and Rove's glyph column is the one place turn state is drawn.
        next.set(tabId, stripEngineStatusPrefix(title, liveEngines.resolve(key)))
      }
      if (next.size === prev.size && [...next].every(([id, v]) => prev.get(id) === v)) return prev
      return next
    })

    // Pass 2: attach/detach detectors per the tab's process identity.
    for (const tab of state.tabs) {
      const target = targetFor(taskId, tab, vendorRef.current, (key) => liveEngines.resolve(key))
      if (!target) continue
      const existing = turnPolls.get(tab.id)
      if (existing && existing.vendor === target.vendor && existing.key === target.key) {
        attached.add(tab.id)
        continue
      }
      if (existing) {
        existing.dispose()
        turnPolls.delete(tab.id)
      }
      // Attach only once the PTY exists, so prime() hashes a real first capture.
      if (!reg.has(target.key)) continue
      const tabId = tab.id
      const entry = engineEntry(target.vendor)
      const detector = entry.createTurnDetector()
      const dispose = startTurnStatusPoll(
        {
          detector,
          // Marker-less engines (copilot/kimi without hooks) classify the
          // capture declaratively instead of publishing "unknown".
          ...(entry.screenManifest ? { screenManifest: entry.screenManifest } : {}),
          session: () => {
            const state = hookTabStatesRef.current?.get(tabId)
            return state?.sessionId && state.transcriptPath
              ? { id: state.sessionId, transcriptPath: state.transcriptPath }
              : null
          },
        },
        {
          sessionAttached: async () => true,
          capturePane: async () => {
            const pty = getDefaultPtyRegistry().get(target.key)
            if (!pty) throw new Error("pty gone")
            return pty
              .capture()
              .map((row) => row.map((chunk) => chunk.text).join(""))
              .join("\n")
          },
          // Notification edges are detected downstream on the merged map (`use-tab-turn-state`).
          setTurnState: async (turn) => {
            setTurnStates((prev) => new Map(prev).set(tabId, turn))
          },
        },
      )
      turnPolls.set(tabId, { dispose, vendor: target.vendor, key: target.key })
      attached.add(tabId)
    }

    // Closed, degraded, or a user-typed engine that exited: stop polling.
    for (const [id, poll] of turnPolls) {
      if (attached.has(id)) continue
      poll.dispose()
      turnPolls.delete(id)
      setTurnStates((prev) => {
        const next = new Map(prev)
        next.delete(id)
        return next
      })
    }

    setTurnVendors((prev) => {
      const next = new Map<string, VendorId>()
      for (const [id, poll] of turnPolls) next.set(id, poll.vendor)
      if (next.size === prev.size && [...next].every(([id, v]) => prev.get(id) === v)) return prev
      return next
    })
  }, [])

  // A title push can flip a tab's engine identity; re-evaluate immediately.
  // Deferred one microtask (coalesced): a fresh subscription seeds SYNCHRONOUSLY
  // inside the store's reconcile loop, which must never be re-entered.
  useEffect(() => {
    let active = true
    let scheduled = false
    const unsub = titleStoreRef.current?.subscribe(() => {
      if (scheduled) return
      scheduled = true
      queueMicrotask(() => {
        scheduled = false
        if (active) reconcile()
      })
    })
    return () => {
      active = false
      unsub?.()
    }
  }, [reconcile])

  // Live-engine probe flips (user-typed `claude` up or exited) attach/detach at once.
  useEffect(() => {
    return getDefaultLiveEngines().subscribe(reconcile)
  }, [reconcile])

  useEffect(() => {
    const timer = setInterval(reconcile, TURN_POLL_ATTACH_MS)
    return () => clearInterval(timer)
  }, [reconcile])

  // Real input changes (and mount); the tick only covers lazy PTY attach.
  useEffect(() => {
    void deps.taskId
    void deps.worktree
    void deps.vendor
    void deps.state
    reconcile()
  }, [deps.taskId, deps.worktree, deps.vendor, deps.state, reconcile])

  useEffect(() => {
    return () => {
      for (const poll of turnPollsRef.current.values()) poll.dispose()
      titleStoreRef.current?.dispose()
    }
  }, [])

  return { turnStates, liveTitles, rawTitles, turnVendors }
}
