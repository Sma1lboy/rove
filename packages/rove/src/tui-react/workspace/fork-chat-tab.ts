/**
 * Fork-this-chat (`chat.tab.fork`): a new tab in the SAME worktree that opens
 * on the active conversation and diverges (`quick-fork.ts` forks the WORKTREE).
 * Only the join: fork flags live in `engineForkArgv`, tab state in `terminal-tabs-core`.
 */

import { engineLaunchArgv, withPinnedSessionId } from "@/engine/engine-presets"
import type { VendorId } from "@/types/vendor"
import {
  type EngineTab,
  type TabsState,
  type TerminalTab,
  addTab,
  initialTabs,
  setTabEngineCommand,
  setTabForkFrom,
  setTabInitialPrompt,
} from "../../tui/workspace/terminal-tabs-core"

/**
 * New tab that LAUNCHES `pick` but speaks `protocol`, forking `sourceSessionId`.
 * They split for a wrapper preset (`claudecpa` runs, claude's fork flags
 * apply), which `EngineTab.engineCommand` vs `vendor` already expresses.
 */
export function addForkTab(state: TabsState, pick: VendorId, protocol: VendorId, sourceSessionId: string): TabsState {
  const next = addTab(state, protocol)
  const launched = pick === protocol ? next : setTabEngineCommand(next, next.activeId, pick)
  return setTabForkFrom(launched, launched.activeId, sourceSessionId)
}

/** New engine tab pinned to `vendor`, opening on the handoff brief. */
export function addHandoffTab(state: TabsState, vendor: VendorId, prompt: string): TabsState {
  const next = addTab(state, vendor)
  return setTabInitialPrompt(next, next.activeId, prompt)
}

/** A child task's `tab-1` forking `sourceSessionId`: {@link addForkTab}'s tab, as the first one. */
export function forkFirstTab(pick: VendorId, protocol: VendorId, sourceSessionId: string): TabsState {
  const { sessionId } = withPinnedSessionId(engineLaunchArgv({ vendor: protocol }), protocol)
  const seed = initialTabs()
  return {
    ...seed,
    tabs: seed.tabs.map(
      (tab): TerminalTab =>
        tab.kind === "engine"
          ? {
              ...tab,
              vendor: protocol,
              ...(pick === protocol ? {} : { engineCommand: pick }),
              forkFrom: sourceSessionId,
              ...(sessionId ? { sessionId } : {}),
            }
          : tab,
    ),
  }
}

/**
 * Whether the task's own conversation already runs: an engine tab that spawned
 * (a transcript exists), or its canonical (first) engine tab holding a live PTY
 * even before a transcript (the engine may sit at a first-run prompt).
 */
export function engineStarted(state: TabsState, isLive: (tab: EngineTab) => boolean): boolean {
  const engines = state.tabs.filter((tab): tab is EngineTab => tab.kind === "engine")
  return engines.some((tab) => tab.spawned) || (engines[0] !== undefined && isLive(engines[0]))
}

/**
 * The task's own engine tab when no conversation ever ran in it. A pick
 * there is the task's first conversation, not a second one.
 */
export function unstartedEngineTab(state: TabsState, isLive: (tab: EngineTab) => boolean): EngineTab | undefined {
  if (engineStarted(state, isLive)) return undefined
  return state.tabs.find((tab): tab is EngineTab => tab.kind === "engine")
}

/** Point a never-started engine tab at `vendor` with a fresh pinned session, and show it. */
export function retargetUnstartedEngine(state: TabsState, tabId: string, vendor: VendorId): TabsState {
  const { sessionId } = withPinnedSessionId(engineLaunchArgv({ vendor }), vendor)
  return {
    ...state,
    activeId: tabId,
    tabs: state.tabs.map(
      (tab): TerminalTab => (tab.id === tabId && tab.kind === "engine" ? { ...tab, vendor, sessionId } : tab),
    ),
  }
}
