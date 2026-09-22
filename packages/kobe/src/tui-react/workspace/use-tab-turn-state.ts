/**
 * Per-tab turn state for the tab strip, hook-first with poll fallback: the
 * daemon's hook-driven per-tab state wins per tabId (`turn-state-merge.ts`)
 * over `useTurnPolls` (which also supplies `liveTitles`/`turnVendors`).
 *
 * Owns background-tab notifications: a rising edge into done/error/needs_input
 * on a NON-active tab toasts + marks unread. `attentionEdges`' seed rule keeps a
 * replayed sticky `turn_complete` from re-toasting; TerminalTabs remounts per
 * task, so switches re-seed.
 *
 * Also owns the strip's half of the DURABLE seen bit (`completion-seen.ts`,
 * shared with the sidebar lamp) so a read completion doesn't look fresh after
 * a restart. The strip writes its own because narrow layout hides the rail.
 */

import { useEffect, useMemo, useRef } from "react"
import type { ChatTabTurnState } from "../../engine/turn-detector"
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
import { type HookTabState, mergeTurnStates } from "../../tui/workspace/turn-state-merge"
import { soloKey } from "../../tui/workspace/turn-target"
import type { VendorId } from "../../types/vendor"
import { useOptionalKV } from "../context/kv"
import type { NotificationsContext } from "../context/notifications"
import { useLatest } from "../lib/use-latest"
import { completionSeenKey, markCompletionSeen, seenCompletionTabs } from "./completion-seen"
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
  notif: NotificationsContext
  /** RECORDS each tab's latest live title. */
  update?: (next: TabsState) => void
  /** Confirmed ESC interrupt on a hook-running tab; reported as `turn-interrupted`. */
  onEngineInterrupt?: (tabId: string) => void
}): {
  turnStates: ReadonlyMap<string, ChatTabTurnState>
  liveTitles: ReadonlyMap<string, string>
  turnVendors: ReadonlyMap<string, VendorId>
  /** Tabs whose current completion the durable record already covers. */
  seenTabs: ReadonlySet<string>
} {
  const { turnStates: pollStates, liveTitles, rawTitles, turnVendors } = useTurnPolls(deps)

  const turnStates = useMemo(() => mergeTurnStates(deps.hookTabStates, pollStates), [deps.hookTabStates, pollStates])

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
  useEffect(() => {
    const next = new Map<string, string>()
    for (const [tabId, turn] of turnStates) next.set(tabId, turn)
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
      })
    }
  }, [turnStates])

  const seenTabs = useDurableTabSeen(deps.taskId, deps.hookTabStates, deps.state.activeId)

  return { turnStates, liveTitles, turnVendors, seenTabs }
}

/**
 * The strip's counterpart to the sidebar's `useDurableCompletionSeen`. Only a
 * HOOK completion carries the stamp the mark is keyed on; poll-inferred `done`
 * has none, so poll-only tabs never digest rather than use an invented stamp.
 * The write is an effect because `kv.set` re-renders every KV consumer.
 */
export function useDurableTabSeen(
  taskId: string,
  hookTabStates: ReadonlyMap<string, HookTabState> | undefined,
  activeId: string,
): ReadonlySet<string> {
  const kv = useOptionalKV()
  const stamps: [string, number | undefined][] = []
  for (const [tabId, entry] of hookTabStates ?? []) {
    if (entry.state === "turn_complete") stamps.push([tabId, entry.at])
  }
  const seenTabs = seenCompletionTabs(kv, taskId, stamps)
  // Sitting in a finished tab consumes it ("seen means consumed"), recorded
  // here so it holds when the rail is off screen.
  const activeAt = hookTabStates?.get(activeId)
  const at = activeAt?.state === "turn_complete" ? activeAt.at : undefined
  const activeSeen = seenTabs.has(activeId)
  useEffect(() => {
    if (!kv || at === undefined || activeSeen) return
    markCompletionSeen(kv, completionSeenKey(taskId, activeId), at)
  }, [kv, taskId, activeId, at, activeSeen])
  return seenTabs
}
