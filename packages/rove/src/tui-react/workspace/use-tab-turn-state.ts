/**
 * The tab strip's per-tab inputs that are not status: live titles and engine
 * identity (`useTurnPolls`), the ESC-interrupt report, and the background-tab
 * toasts. What each tab SHOWS is the daemon's row status (`row-status-sync.ts`);
 * nothing here derives one.
 *
 * Owns background-tab notifications, read off the daemon's tab statuses: a
 * rising edge into done/error/needs_input on a NON-active tab toasts + marks
 * unread (a dispatched task's tabs stay silent — see `taskDispatched`).
 * `attentionEdges`' seed rule keeps a replayed finished turn from re-toasting;
 * TerminalTabs remounts per task, so switches re-seed.
 */

import type { TabStatus } from "@sma1lboy/rove-daemon/daemon/row-status"
import { useEffect, useMemo, useRef } from "react"
import { attentionEdges, chipAttentionKind } from "../../tui/lib/notify-state"
import { defaultShell } from "../../tui/panes/terminal/pty-types"
import { InterruptObserver } from "../../tui/workspace/interrupt-observer"
import { getDefaultLiveEngines } from "../../tui/workspace/live-engine"
import { createTabIdentityObserver } from "../../tui/workspace/terminal-tab-identity"
import {
  type TabsState,
  type TerminalTab,
  setTabLastTitle,
  setTabLiveVendor,
} from "../../tui/workspace/terminal-tabs-core"
import type { HookTabState } from "../../tui/workspace/turn-state-merge"
import { soloKey } from "../../tui/workspace/turn-target"
import type { VendorId } from "../../types/vendor"
import type { NotificationsContext } from "../context/notifications"
import { useLatest } from "../lib/use-latest"
import { useRowStatusMap } from "./row-status-sync"
import { tabTitle } from "./tab-strip"
import { useTurnPolls } from "./use-turn-polls"

export function useTabTurnState(deps: {
  taskId: string
  worktree: string
  vendor: VendorId
  state: TabsState
  hookTabStates?: ReadonlyMap<string, HookTabState>
  /** The toast's context line under the tab label. */
  taskTitle?: string
  /** The task was dispatched by another Rove session (`.dispatcher`): its tabs
   *  toast and mark unread, but never ring. */
  taskDispatched?: boolean
  notif: NotificationsContext
  /** RECORDS each tab's latest live title. */
  update?: (next: TabsState) => void
  /** Confirmed ESC interrupt on a hook-running tab; reported as `turn-interrupted`. */
  onEngineInterrupt?: (tabId: string) => void
  onScreenInput?: (tabId: string, blocked: boolean) => Promise<void>
}): {
  liveTitles: ReadonlyMap<string, string>
  turnVendors: ReadonlyMap<string, VendorId>
} {
  const { liveTitles, rawTitles, turnVendors } = useTurnPolls(deps)
  const tabStatuses = useRowStatusMap()[deps.taskId]?.tabs
  const turnStates = useMemo(() => notifyTurns(tabStatuses), [tabStatuses])

  // ESC interrupt: a hook-claimed `running` tab whose RAW title flipped to the
  // resting form ended its turn with no hook (claude-code's abort runs none).
  // The observer owns the Stop-race debounce; callbacks read LIVE refs so a
  // Stop inside the window wins and the confirm checks the daemon's current claim.
  const hookStatesRef = useLatest(deps.hookTabStates)
  const onInterruptRef = useLatest(deps.onEngineInterrupt)
  const observerRef = useRef<InterruptObserver | null>(null)
  if (observerRef.current === null) {
    observerRef.current = new InterruptObserver({
      confirm: (tabId) => hookStatesRef.current?.get(tabId)?.state === "running",
      report: (tabId) => onInterruptRef.current?.(tabId),
    })
  }
  useEffect(() => {
    const observer = observerRef.current
    if (!observer) return
    const running = new Set<string>()
    for (const [tabId, entry] of deps.hookTabStates ?? []) {
      if (entry.state === "running") running.add(tabId)
    }
    // A tab missing from `running` disarms any pending confirm (Stop/permission landed).
    const tabIds = new Set([...running, ...rawTitles.keys()])
    for (const tabId of tabIds) {
      observer.observe(tabId, {
        rawTitle: rawTitles.get(tabId),
        vendor: turnVendors.get(tabId),
        hookRunning: running.has(tabId),
      })
    }
  }, [deps.hookTabStates, rawTitles, turnVendors])
  useEffect(() => () => observerRef.current?.dispose(), [])

  // A restored title can arrive before the engine starts. Only process
  // observations from this mount can establish an engine-exit edge.
  const updateRef = useLatest(deps.update)
  const titleStateRef = useLatest(deps.state)
  const identityObserver = useRef<ReturnType<typeof createTabIdentityObserver> | null>(null)
  if (!identityObserver.current) identityObserver.current = createTabIdentityObserver()
  useEffect(() => {
    const apply = updateRef.current
    if (!apply) return
    const engines = getDefaultLiveEngines()
    const record = () => {
      const current = titleStateRef.current
      let next = current
      for (const [tabId, title] of liveTitles) {
        const tab = next.tabs.find((t) => t.id === tabId)
        if (!tab) continue
        const key = soloKey(deps.taskId, tab)
        const live = key ? engines.resolve(key) : undefined
        const demoted = identityObserver.current?.(tab, live, [defaultShell()])
        if (demoted && demoted !== tab) {
          next = { ...next, tabs: next.tabs.map((t) => (t.id === tabId ? demoted : t)) }
          continue // the reset already cleared lastTitle/liveVendor
        }
        next = setTabLastTitle(next, tabId, title)
        if (live !== undefined) next = setTabLiveVendor(next, tabId, live)
      }
      if (next !== current) apply(next)
    }
    record()
    return engines.subscribe(record)
  }, [liveTitles, deps.taskId])

  // Background-tab rising edges; `prev === null` until the first observation.
  const prevRef = useRef<ReadonlyMap<string, string> | null>(null)
  const stateRef = useLatest(deps.state)
  const notifRef = useLatest(deps.notif)
  const vendorRef = useLatest(deps.vendor)
  const taskIdRef = useLatest(deps.taskId)
  const taskTitleRef = useLatest(deps.taskTitle)
  const dispatchedRef = useLatest(deps.taskDispatched)
  useEffect(() => {
    // Nothing from the daemon for this task yet: wait, so its first snapshot seeds rather than toasts.
    if (turnStates === null) return
    const next = turnStates
    const edges = attentionEdges(prevRef.current, next, stateRef.current.activeId, chipAttentionKind)
    prevRef.current = next
    for (const { key: tabId, kind } of edges) {
      const tab: TerminalTab | undefined = stateRef.current.tabs.find((tb) => tb.id === tabId)
      if (!tab) continue
      notifRef.current.notify({
        kind,
        taskId: taskIdRef.current,
        tabId,
        // Mirrors the Inbox card: tab label leads, task title is the body.
        title: tabTitle(tab, vendorRef.current),
        body: taskTitleRef.current,
        silent: dispatchedRef.current,
        turnEnd: true,
      })
    }
  }, [turnStates])

  return { liveTitles, turnVendors }
}

/**
 * The daemon's tab statuses as the toast vocabulary (`chipAttentionKind`): a
 * finished turn nobody has seen is `done`; a restored session announces nothing.
 */
export function notifyTurns(tabs: Readonly<Record<string, TabStatus>> | undefined): ReadonlyMap<string, string> | null {
  if (tabs === undefined) return null
  const out = new Map<string, string>()
  for (const [tabId, status] of Object.entries(tabs)) {
    switch (status.kind) {
      case "unseen":
        out.set(tabId, "done")
        break
      case "needs-input":
        out.set(tabId, "needs_input")
        break
      case "attention":
        out.set(tabId, status.reason ?? "error")
        break
      default:
        out.set(tabId, status.kind)
    }
  }
  return out
}
