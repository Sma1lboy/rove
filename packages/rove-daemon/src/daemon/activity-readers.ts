/**
 * Pure READ projections of the activity ledger into wire payloads.
 *
 * "What is in the ledger" ≠ "what is working". The ledger keeps known-idle TAB
 * entries on purpose: the sidebar draws ABSENCE as unknown (◌), so "idle" must
 * stay distinct from "never heard of it". A gate reading the replay would
 * count every task that ever opened a tab as busy. So: {@link workingTaskIds}
 * for a gate, {@link liveSessions} for per-session telemetry,
 * {@link replaySnapshot} for late-subscriber hydration.
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
 * Tasks whose derived rollup is non-idle; one working tab suffices. What a
 * GATE wants — deliberately NOT {@link replaySnapshot} (see header).
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
 * Every tab with a live engine SESSION, idle included (a tab between turns
 * still has a transcript for the footer's `ctx N%`).
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
 * `engine-state` replay: non-idle task rollups, plus EVERY tab entry —
 * known-idle included on purpose (see header).
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
