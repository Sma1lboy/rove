/**
 * The READ half of the activity ledger: pure projections of the two maps the
 * registry writes into the wire payloads consumers read.
 *
 * Split out because "what is in the ledger" and "what is working" are not the
 * same question, and one reader answering both got them confused. The ledger
 * deliberately keeps known-idle TAB entries — the client holds them as
 * tombstones, because the sidebar draws ABSENCE as unknown (a dotted ◌), so
 * "the daemon says this tab is idle" has to stay distinguishable from "the
 * daemon has never heard of it". A gate that read that replay counted every
 * task which had ever opened a tab as busy, which pinned the worktree-changes
 * collector's 2s cadence on worktrees nothing was writing to.
 *
 * So each consumer names its own question: {@link workingTaskIds} for a gate,
 * {@link liveSessions} for per-session telemetry, {@link replaySnapshot} for a
 * late subscriber's hydration.
 *
 * Pure: no timers, no bus, no I/O — the registry owns those.
 */

import type { EffectiveActivity } from "./activity-arbitrate.ts"
import type { EngineSessionInfo } from "./activity-reduce.ts"
import { type RollupCandidate, type RollupTabEntry, deriveTaskActivity, rollupCandidates } from "./activity-rollup.ts"
import type { EngineActivityDetail, TaskActivityState } from "./contracts.ts"
import type { ChannelPayloads } from "./protocol.ts"

export type EngineStatePayload = ChannelPayloads["engine-state"]

/** The subset of a ledger entry the wire payload reads. */
export interface PayloadSource {
  readonly state: TaskActivityState
  readonly detail?: EngineActivityDetail
  readonly session?: EngineSessionInfo
  readonly at: number
}

/** One tab's record, as the readers see it. */
export interface ReadableTabEntry extends RollupTabEntry {
  readonly effective: EffectiveActivity
}

/** taskId → tabId → entry. */
export type TabLedger = ReadonlyMap<string, ReadonlyMap<string, ReadableTabEntry>>
/** taskId → the task's TAB-LESS hook entry (an engine started outside a kobe tab). */
export type TablessLedger = ReadonlyMap<string, RollupCandidate>

export function activityPayload(taskId: string, entry: PayloadSource, tabId?: string): EngineStatePayload {
  return {
    taskId,
    ...(tabId ? { tabId } : {}),
    state: entry.state,
    ...(entry.detail ? { detail: entry.detail } : {}),
    ...(entry.session ? { sessionId: entry.session.id } : {}),
    ...(entry.session?.transcriptPath ? { transcriptPath: entry.session.transcriptPath } : {}),
    at: entry.at,
  }
}

/** Every task with a ledger entry at either level. */
export function ledgerTaskIds(tabless: TablessLedger, tabs: TabLedger): Set<string> {
  return new Set([...tabless.keys(), ...tabs.keys()])
}

/** The derived task-level state, or `undefined` when nothing ever reported. */
export function taskRollup(taskId: string, tabless: TablessLedger, tabs: TabLedger): RollupCandidate | undefined {
  return deriveTaskActivity(rollupCandidates(tabless.get(taskId), tabs.get(taskId)))
}

/**
 * Tasks whose engine is doing something — the derived rollup, filtered to
 * non-idle. The rollup already folds every tab (activity-rollup.ts), so one
 * working tab puts its task here however quiet the siblings are.
 *
 * This is what a GATE wants ("is an agent working in there?"), and it is
 * deliberately NOT {@link replaySnapshot} — see this file's header.
 */
export function workingTaskIds(tabless: TablessLedger, tabs: TabLedger): string[] {
  const out: string[] = []
  for (const taskId of ledgerTaskIds(tabless, tabs)) {
    const derived = taskRollup(taskId, tabless, tabs)
    if (derived && derived.state !== "idle") out.push(taskId)
  }
  return out
}

/**
 * Every tab holding a live engine SESSION, whatever its state — the
 * context-usage collector's targets. Idle belongs here: a tab between turns
 * still has a transcript, and the footer's `ctx N%` must keep rendering.
 */
export function liveSessions(tabs: TabLedger): EngineStatePayload[] {
  const out: EngineStatePayload[] = []
  for (const [taskId, entries] of tabs) {
    for (const [tabId, entry] of entries) {
      if (entry.effective.session) out.push(activityPayload(taskId, entry.effective, tabId))
    }
  }
  return out
}

/**
 * The whole `engine-state` replay for a late subscriber: each task's derived
 * rollup, non-idle only (an idle task has no badge to draw), plus EVERY tab
 * entry so the client rebuilds its per-tab map too — known-idle ones included,
 * which is the point and not a missing filter (see this file's header).
 */
export function replaySnapshot(tabless: TablessLedger, tabs: TabLedger): EngineStatePayload[] {
  const out: EngineStatePayload[] = []
  for (const taskId of ledgerTaskIds(tabless, tabs)) {
    const derived = taskRollup(taskId, tabless, tabs)
    if (derived && derived.state !== "idle") out.push(activityPayload(taskId, derived))
  }
  for (const [taskId, entries] of tabs) {
    for (const [tabId, entry] of entries) out.push(activityPayload(taskId, entry.effective, tabId))
  }
  return out
}
