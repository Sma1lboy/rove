/**
 * Wire-payload types + pure parse/decode/compare helpers for
 * `RemoteOrchestrator`. Knows the daemon's payload SHAPES and nothing about the
 * connection, so the sibling modules can all depend on it without depending on
 * each other. Re-exported from `remote-orchestrator.ts`.
 */

import type {
  ChannelPayloads,
  EngineQuotaUsage,
  EngineQuotaWindow,
  SerializedTask,
  UiPrefsPayload,
} from "@sma1lboy/kobe-daemon/daemon/protocol"
import type { EngineActivityDetail, TaskActivityState } from "../engine/hook-events.ts"
import type { Task } from "../types/task.ts"
import { toTaskId } from "../types/task.ts"

/** Per-task engine activity, accumulated from the daemon's `engine-state` channel. */
export interface TaskEngineState {
  readonly state: TaskActivityState
  readonly detail?: EngineActivityDetail
  /** The engine's OWN latest session id from its hook payload — works even for
   *  user-typed engines kobe never spawned. Absent on old daemons. */
  readonly sessionId?: string
  /** The session's transcript file, when the hook payload named it. */
  readonly transcriptPath?: string
  /** The tab that produced this entry. On the TASK rollup it records the last
   *  writer, so a tab-scoped idle only clears a rollup its own tab owns. */
  readonly tabId?: string
  readonly at: number
}

/** Per-TAB engine activity (taskId → tabId → state). Sparse: only live
 *  non-idle tabs; sessions without a tab identity stay task-level only. */
export type EngineTabStateMap = ReadonlyMap<string, ReadonlyMap<string, TaskEngineState>>

/** Durable daemon-owned attention episode, pushed as a full snapshot. */
export type AttentionInboxItem = ChannelPayloads["attention.inbox"]["items"][number]

export {
  type WorktreeChangesMap,
  parseWorktreeChangesPayload,
  sameWorktreeChangesMap,
} from "./remote-orchestrator-worktree-changes.ts"
export {
  type RowToken,
  type RowTokenMap,
  liveRowTokens,
  parseRowTokensPayload,
  sameRowTokenMap,
} from "./remote-orchestrator-row-tokens.ts"

/**
 * A long daemon operation IN FLIGHT for a task, from `task.jobs` (`git worktree
 * add` is minute-class on a huge repo). Presence means "running"; `done`/`error`
 * remove the entry, so a replayed terminal payload is a no-op. The outcome goes
 * to the blocking RPC's caller, not here.
 */
export interface TaskJobState {
  readonly kind: "ensureWorktree"
}

/** Bounded description (type + 120-char prefix) of a dropped payload for `client.log`. */
export function describePayload(value: unknown): string {
  if (value === undefined) return "undefined"
  if (value === null) return "null"
  const type = Array.isArray(value) ? "array" : typeof value
  let text: string
  try {
    text = typeof value === "string" ? value : JSON.stringify(value)
  } catch {
    text = String(value)
  }
  if (text.length > 120) text = `${text.slice(0, 120)}…`
  return `${type}:${text}`
}

/**
 * Decode a `ui-prefs` wire payload into a fully-defaulted {@link UiPrefsPayload},
 * or `null` when unusable (no `theme` key, or a non-string non-null theme).
 * Sole owner of the backward-compat defaults: an older daemon omits newer
 * fields, and each MUST resolve to "absent → leave it", never a hard reset.
 *
 *  - `locale` absent → "" (UNSET), so it never yanks the language to English.
 *  - `sortMode` absent → "default"; `keysCollapsed` absent → false (expanded);
 *    `projectFilter` absent/empty → null (all projects); `focusAccent` → null.
 *  - `transparentBackground` absent → TRUE, matching `ui-prefs-watcher` and
 *    `persisted-ui-prefs` (`!== false`); defaulting off turns remote panes
 *    opaque against an older daemon while local ones stay transparent.
 */
export function decodeUiPrefsPayload(payload: unknown): UiPrefsPayload | null {
  const p = payload as Partial<UiPrefsPayload> | undefined
  // `theme` is the marker KEY (every daemon sends it) but its VALUE is nullable:
  // `state.json` may name none. Null means "keep this pane's theme"; dropping the
  // payload would lose transparency, locale and sort mode too.
  if (!p || typeof p !== "object" || !("theme" in p)) return null
  if (p.theme !== null && typeof p.theme !== "string") return null
  return {
    theme: typeof p.theme === "string" && p.theme.length > 0 ? p.theme : null,
    // Absent (older daemon) stays absent and `applyUiPrefs` skips it; `null` is
    // the file's "unset" and converges on the default.
    ...("themeMode" in p ? { themeMode: typeof p.themeMode === "string" ? p.themeMode : null } : {}),
    transparentBackground: p.transparentBackground !== false,
    focusAccent: typeof p.focusAccent === "string" ? p.focusAccent : null,
    locale: typeof p.locale === "string" ? p.locale : "",
    sortMode: p.sortMode === "recent" || p.sortMode === "attention" ? p.sortMode : "default",
    keysCollapsed: p.keysCollapsed === true,
    projectFilter: typeof p.projectFilter === "string" && p.projectFilter.length > 0 ? p.projectFilter : null,
  }
}

/** Per-vendor quota snapshots from `usage.snapshot`; `null` = no daemon data yet. */
export type UsageSnapshotMap = ReadonlyMap<string, EngineQuotaUsage>

/** Context-window occupancy per live session, keyed `taskId::tabId`, from
 *  `usage.context`; `null` = no daemon data yet, and the footer renders nothing. */
export interface ContextUsage {
  readonly contextTokens: number
  readonly contextWindowTokens?: number
  readonly approximate?: boolean
  /** Session token totals, when the vendor's history reader reports them.
   *  Absent means "this engine does not say", never zero. */
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly cacheReadTokens?: number
  readonly cacheCreationTokens?: number
}
export type ContextUsageMap = ReadonlyMap<string, ContextUsage>

const TOKEN_TOTAL_FIELDS = ["inputTokens", "outputTokens", "cacheReadTokens", "cacheCreationTokens"] as const

/**
 * Parse a `usage.context` payload; `null` for a malformed one so a good map
 * isn't clobbered. Trust boundary: one bad field in any row (including a
 * non-number token total) drops the whole payload, never coerced or skipped.
 */
export function parseContextUsagePayload(payload: unknown): Map<string, ContextUsage> | null {
  const context = (payload as { context?: unknown } | undefined)?.context
  if (!context || typeof context !== "object" || Array.isArray(context)) return null
  const map = new Map<string, ContextUsage>()
  for (const [key, value] of Object.entries(context as Record<string, unknown>)) {
    const v = value as Record<string, unknown> | undefined
    if (typeof v?.contextTokens !== "number") return null
    if (v.contextWindowTokens !== undefined && typeof v.contextWindowTokens !== "number") return null
    const totals: Record<string, number> = {}
    for (const field of TOKEN_TOTAL_FIELDS) {
      const raw = v[field]
      if (raw === undefined) continue
      if (typeof raw !== "number") return null
      totals[field] = raw
    }
    map.set(key, {
      contextTokens: v.contextTokens,
      ...(typeof v.contextWindowTokens === "number" ? { contextWindowTokens: v.contextWindowTokens } : {}),
      ...(v.approximate === true ? { approximate: true } : {}),
      ...totals,
    })
  }
  return map
}

/** Value equality for two context maps (gate re-renders on real changes). */
export function sameContextUsageMap(a: ContextUsageMap, b: ContextUsageMap): boolean {
  if (a.size !== b.size) return false
  for (const [key, value] of a) {
    const other = b.get(key)
    if (
      !other ||
      other.contextTokens !== value.contextTokens ||
      other.contextWindowTokens !== value.contextWindowTokens ||
      other.approximate !== value.approximate ||
      TOKEN_TOTAL_FIELDS.some((field) => other[field] !== value[field])
    )
      return false
  }
  return true
}

/**
 * Folded `engine.lifecycle` state per task (the sidebar's subagent mark).
 * Compaction keeps NO client state: esc during /compact cancels its end event,
 * so a flag would go stale. It shows as the normal running animation.
 */
export type EngineLifecycleState = { readonly subagents: number }
export type EngineLifecycleMap = ReadonlyMap<string, EngineLifecycleState>

/** One entry of the `task.recentEvents` feed (daemon EngineEventLog wire shape). */
export interface RecentTaskEvent {
  readonly kind: string
  readonly tabId?: string
  readonly vendor?: string
  readonly detail?: Record<string, unknown>
  readonly at: number
}

/** Parse `usage.snapshot` into vendor→usage; `null` if malformed. Trust
 *  boundary: one bad window field drops the whole payload. */
export function parseUsageSnapshotPayload(payload: unknown): Map<string, EngineQuotaUsage> | null {
  const usage = (payload as { usage?: unknown } | undefined)?.usage
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null
  const map = new Map<string, EngineQuotaUsage>()
  for (const [vendor, value] of Object.entries(usage as Record<string, unknown>)) {
    const snapshot = value as { windows?: unknown; capturedAt?: unknown } | undefined
    if (typeof snapshot?.capturedAt !== "number" || !Array.isArray(snapshot.windows)) return null
    const windows: EngineQuotaWindow[] = []
    for (const raw of snapshot.windows) {
      const w = raw as { kind?: unknown; label?: unknown; percent?: unknown; resetsAt?: unknown } | undefined
      if (typeof w?.kind !== "string" || typeof w.label !== "string" || typeof w.percent !== "number") return null
      if (w.resetsAt !== null && typeof w.resetsAt !== "number") return null
      windows.push({ kind: w.kind, label: w.label, percent: w.percent, resetsAt: w.resetsAt })
    }
    map.set(vendor, { windows, capturedAt: snapshot.capturedAt })
  }
  return map
}

/** Value equality for two usage maps (gate re-renders on real changes). */
export function sameUsageSnapshotMap(a: UsageSnapshotMap, b: UsageSnapshotMap): boolean {
  if (a.size !== b.size) return false
  for (const [vendor, usage] of a) {
    const other = b.get(vendor)
    if (!other || other.capturedAt !== usage.capturedAt || other.windows.length !== usage.windows.length) return false
    for (let i = 0; i < usage.windows.length; i++) {
      const x = usage.windows[i]
      const y = other.windows[i]
      if (!x || !y || x.kind !== y.kind || x.label !== y.label || x.percent !== y.percent || x.resetsAt !== y.resetsAt)
        return false
    }
  }
  return true
}

/**
 * One worktree's transcript facts from `transcript.activity` (collected once in
 * the daemon instead of per Ops pane): newest transcript mtime plus the latest
 * completion marker (ChatTab "done" chip). Tmux quiescence stays in the Ops pane.
 */
export interface TranscriptActivity {
  readonly mtimeMs: number
  readonly completionId: string | null
  readonly completionAt: number
}

/** Keyed by worktree path. `null` = daemon lacks the channel or `init()` is
 *  pending; the Ops pane then polls locally. */
export type TranscriptActivityMap = ReadonlyMap<string, TranscriptActivity>

/** Parse `transcript.activity` into path→facts; `null` if malformed. */
export function parseTranscriptActivityPayload(payload: unknown): Map<string, TranscriptActivity> | null {
  const activity = (payload as { activity?: unknown } | undefined)?.activity
  if (!activity || typeof activity !== "object" || Array.isArray(activity)) return null
  const map = new Map<string, TranscriptActivity>()
  for (const [path, value] of Object.entries(activity as Record<string, unknown>)) {
    const v = value as { mtimeMs?: unknown; completionId?: unknown; completionAt?: unknown } | undefined
    if (typeof v?.mtimeMs !== "number" || typeof v.completionAt !== "number") return null
    if (v.completionId !== null && typeof v.completionId !== "string") return null
    map.set(path, { mtimeMs: v.mtimeMs, completionId: v.completionId, completionAt: v.completionAt })
  }
  return map
}

/** Entry-wise value equality for two transcript-activity maps. */
export function sameTranscriptActivityMap(a: TranscriptActivityMap, b: TranscriptActivityMap): boolean {
  if (a.size !== b.size) return false
  for (const [path, v] of a) {
    const other = b.get(path)
    if (
      !other ||
      other.mtimeMs !== v.mtimeMs ||
      other.completionId !== v.completionId ||
      other.completionAt !== v.completionAt
    )
      return false
  }
  return true
}

export {
  type DaemonConnectionState,
  type OrchestratorSignals,
  type RemoteOrchestratorOptions,
  RECONNECT_LOG_ATTEMPT_CEILING,
  shouldLogReconnectAttempt,
} from "./remote-orchestrator-contract.ts"

export function deserializeTask(s: SerializedTask): Task {
  return {
    id: toTaskId(s.id),
    title: s.title,
    repo: s.repo,
    branch: s.branch,
    worktreePath: s.worktreePath,
    kind: s.kind,
    ...(s.scratch ? { scratch: true } : {}),
    ...(s.routine ? { routine: s.routine } : {}),
    status: s.status,
    pinned: s.pinned,
    vendor: s.vendor,
    command: s.command,
    prStatus: s.prStatus,
    modelEffort: s.modelEffort,
    model: s.model,
    tier: s.tier,
    groupId: s.groupId,
    observedLanguage: s.observedLanguage,
    deletion: s.deletion,
    quotaResume: s.quotaResume,
    linkedWorkItem: s.linkedWorkItem,
    dispatcher: s.dispatcher,
    prompt: s.prompt,
    baseRef: s.baseRef,
    worktreeName: s.worktreeName,
    report: s.report,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  }
}
