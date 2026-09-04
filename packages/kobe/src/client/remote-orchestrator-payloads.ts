/**
 * Wire-payload types + pure parse/decode/compare helpers for
 * `RemoteOrchestrator`.
 *
 * The seam is the wire: this file knows the daemon's payload SHAPES and
 * nothing about the connection, so decoding a task or comparing two snapshots
 * is checkable against literals with no socket in play. That also makes it the
 * file the other three can all depend on without depending on each other. Same
 * types/functions, moved verbatim, re-exported from `remote-orchestrator.ts`
 * so existing importers (tests, `deserializeTask` callers) keep their path.
 *
 * Also defines {@link OrchestratorSignals} — the explicit "deps bag" of
 * accessor/setter closures `handleOrchestratorEvent`
 * (`remote-orchestrator-events.ts`) and `performInit`
 * (`remote-orchestrator-connect.ts`) operate on, instead of closing over
 * `RemoteOrchestrator`'s private fields directly. Solid signals are plain
 * closures (no `this` binding), so passing them across the file boundary
 * is exactly as cheap as calling them as methods.
 */

import type {
  ChannelName,
  ChannelPayloads,
  EngineQuotaUsage,
  EngineQuotaWindow,
  NoticeEventPayload,
  SerializedTask,
  SubscribeRole,
  TabClosePayload,
  TabOpenPayload,
  UiPrefsPayload,
  UiPromptPayload,
} from "@sma1lboy/kobe-daemon/daemon/protocol"
import type { EngineActivityDetail, TaskActivityState } from "../engine/hook-events.ts"
import type { ReadableState } from "../lib/external-store.ts"
import { type WorktreeChanges, sameWorktreeChanges } from "../tui/panes/sidebar/worktree-changes.ts"
import type { Task } from "../types/task.ts"
import { toTaskId } from "../types/task.ts"
import type { UpdateInfo } from "../version.ts"

/** Per-task engine activity, accumulated from the daemon's `engine-state` channel. */
export interface TaskEngineState {
  readonly state: TaskActivityState
  readonly detail?: EngineActivityDetail
  /** The engine's OWN session id (latest-known, from its hook payload) —
   *  resolves "which engine session is live here" even for user-typed
   *  engines kobe never spawned. Absent on old daemons. */
  readonly sessionId?: string
  /** The session's transcript file, when the hook payload named it. */
  readonly transcriptPath?: string
  /** The tab that produced this entry, when the event carried one — on the
   *  TASK rollup it records which tab last wrote it, so a tab-scoped idle
   *  only clears a rollup its own tab owns. */
  readonly tabId?: string
  readonly at: number
}

/** Per-TAB engine activity (taskId → tabId → state), accumulated from the
 *  same channel's `tabId`-carrying events. Sparse — only tabs with a live
 *  non-idle state; sessions without a tab identity stay task-level only. */
export type EngineTabStateMap = ReadonlyMap<string, ReadonlyMap<string, TaskEngineState>>

/** Durable daemon-owned attention episode, pushed as a full snapshot. */
export type AttentionInboxItem = ChannelPayloads["attention.inbox"]["items"][number]

// The `worktree.changes` wire contract lives in its own module (its payload
// carries two facts per key); re-exported here so existing importers keep
// naming it through this one.
import type { WorktreeChangesMap } from "./remote-orchestrator-worktree-changes.ts"
export {
  type WorktreeChangesMap,
  parseWorktreeChangesPayload,
  sameWorktreeChangesMap,
} from "./remote-orchestrator-worktree-changes.ts"

/**
 * A long daemon operation currently IN FLIGHT for a task, accumulated from
 * the `task.jobs` channel (today: `ensureWorktree` — `git worktree add` is
 * minute-class on a huge repo). Presence in the map means "running"; the
 * terminal phases (`done` / `error`) remove the entry, so a replayed
 * terminal payload to a late subscriber is a harmless no-op. The job's
 * outcome isn't surfaced here — the blocking RPC delivers it to the caller.
 */
export interface TaskJobState {
  readonly kind: "ensureWorktree"
}

/**
 * Compact, bounded description of a dropped event payload for `client.log` —
 * enough to diagnose a malformed daemon frame (the type, and a short prefix of
 * its stringified form) without dumping a huge object into the log. Used only
 * on the drop paths in `handleOrchestratorEvent`.
 */
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
 * or `null` when it's unusable (no `theme` string — the event is then ignored).
 * The single owner of the backward-compat defaults: an older daemon omits newer
 * fields, and each MUST resolve to its "absent → leave it" sentinel rather than
 * a hard reset. These were inline in handleEvent, where the version-negotiation
 * intent was a wall of per-field fallbacks easy to get subtly wrong. Exported
 * for unit tests.
 *
 *  - `locale` absent → "" (UNSET): a payload that never mentioned the language
 *    must not yank it back to English; only a real non-empty locale changes it.
 *  - `sortMode` absent → "default"; `keysCollapsed` absent → false (expanded);
 *    `projectFilter` absent/empty → null (all projects); `transparentBackground`
 *    / `focusAccent` default off / null.
 */
export function decodeUiPrefsPayload(payload: unknown): UiPrefsPayload | null {
  const p = payload as Partial<UiPrefsPayload> | undefined
  if (typeof p?.theme !== "string") return null
  return {
    theme: p.theme,
    transparentBackground: p.transparentBackground === true,
    focusAccent: typeof p.focusAccent === "string" ? p.focusAccent : null,
    locale: typeof p.locale === "string" ? p.locale : "",
    sortMode: p.sortMode === "recent" ? "recent" : "default",
    keysCollapsed: p.keysCollapsed === true,
    projectFilter: typeof p.projectFilter === "string" && p.projectFilter.length > 0 ? p.projectFilter : null,
  }
}

/**
 * Per-vendor quota snapshots from the `usage.snapshot` channel. `null`
 * means "no daemon-collected data yet" (older daemon, or the cache hasn't
 * fetched) — the Settings dashboard then renders nothing.
 */
export type UsageSnapshotMap = ReadonlyMap<string, EngineQuotaUsage>

/**
 * Context-window occupancy per live engine session, keyed `taskId::tabId`,
 * from the `usage.context` channel. `null` means "no daemon-collected data
 * yet" (older daemon, nothing live) — the footer then renders nothing.
 */
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

/**
 * Parse a `usage.context` wire payload. `null` for a malformed one (the event
 * is ignored rather than clobbering a good map). Each entry is validated
 * field-by-field: this is a trust boundary, and one bad row drops the payload.
 */
/** The optional token counts carried alongside the context reading. */
const TOKEN_TOTAL_FIELDS = ["inputTokens", "outputTokens", "cacheReadTokens", "cacheCreationTokens"] as const

export function parseContextUsagePayload(payload: unknown): Map<string, ContextUsage> | null {
  const context = (payload as { context?: unknown } | undefined)?.context
  if (!context || typeof context !== "object" || Array.isArray(context)) return null
  const map = new Map<string, ContextUsage>()
  for (const [key, value] of Object.entries(context as Record<string, unknown>)) {
    const v = value as Record<string, unknown> | undefined
    if (typeof v?.contextTokens !== "number") return null
    if (v.contextWindowTokens !== undefined && typeof v.contextWindowTokens !== "number") return null
    // Same trust-boundary rule as the two fields above: a token count that is
    // present but not a number drops the whole payload rather than being
    // silently coerced or skipped — one bad row means the sender is not the
    // sender we think it is.
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
 * Folded `engine.lifecycle` state per task — the sidebar's subagent mark.
 * Compaction deliberately keeps NO client state: its end event can be
 * cancelled (esc during /compact), so a compacting flag has no reliable
 * clearing edge and could only ever go stale. Compaction shows as the
 * normal running animation instead.
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

/**
 * Parse a `usage.snapshot` wire payload into a vendor→usage map. Returns
 * `null` for a malformed payload (the event is then ignored — never clobber
 * a good map with garbage). Windows are re-validated field-by-field: this is
 * a trust boundary, and one bad row drops the payload, not the field.
 */
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
 * One worktree's daemon-collected transcript facts (perf — deduplicate
 * per-Ops-pane polling), from the `transcript.activity` channel: the newest
 * engine-transcript mtime plus the engine-owned latest-completion marker
 * (drives the ChatTab "done" chip).
 * The per-window tmux quiescence check stays in the Ops pane — this is only
 * the shareable filesystem half.
 */
export interface TranscriptActivity {
  readonly mtimeMs: number
  readonly completionId: string | null
  readonly completionAt: number
}

/**
 * Daemon-collected transcript facts keyed by worktree path, from the
 * `transcript.activity` channel. `null` means "no daemon-collected data":
 * either the daemon predates the channel (absent from `hello.capabilities`)
 * or `init()` hasn't completed — the Ops pane then falls back to its local
 * mtime/completion polling.
 */
export type TranscriptActivityMap = ReadonlyMap<string, TranscriptActivity>

/**
 * Parse a `transcript.activity` wire payload into a path→facts map. Returns
 * `null` for a malformed payload (the event is then ignored — never clobber
 * a good map with garbage). Exported for unit tests.
 */
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

/** Entry-wise value equality for two transcript-activity maps. Exported for unit tests. */
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

/** Daemon connection lifecycle as observed by the TUI during silent recovery. */
export type DaemonConnectionState = "online" | "disconnected"

export interface RemoteOrchestratorOptions {
  /**
   * Bring the daemon back on the socket this client already points
   * at. Shared mode uses the stable production socket; single/owned
   * mode injects a restart function for its per-TUI socket.
   */
  readonly ensureReachable?: () => Promise<unknown>
  /**
   * Subscribe role (KOB). `"gui"` keeps the daemon alive while this
   * orchestrator is connected — pass it only from a real front-end attach
   * (`direct.ts`, the outer monitor). Default `"pane"`: an in-tmux helper
   * (Tasks pane, Ops, settings/new-task windows) subscribes for data but
   * never holds the daemon open after the user quits. See {@link SubscribeRole}.
   */
  readonly role?: SubscribeRole
  /**
   * Per-channel subscribe filter (KOB — per-channel subscribe). Omit to
   * receive EVERY channel (the default — what a primary orchestrator
   * driving the task list needs). Pass a narrow set for a single-purpose
   * consumer: host-boot's UiPrefsSync passes `["ui-prefs", "keybindings"]`
   * so it never receives — nor deserializes — the full `task.snapshot`
   * fan-out it does not read. When the filter excludes `task.snapshot`, the
   * `hello` task hydration is also skipped (the task list would be dead
   * weight), and `worktreeChangesSignal()` is left null (its consumer isn't
   * subscribed). An older daemon ignores the filter and sends everything;
   * the unread channels simply land in signals nobody reads — still cheaper
   * to ask, and correct.
   */
  readonly channels?: readonly ChannelName[]
}

/**
 * The accessor/setter closures `handleOrchestratorEvent` and `performInit`
 * operate on, threaded in by `RemoteOrchestrator` instead of `this`. Built
 * once in the constructor from the same Solid signals the class's own
 * read-signal methods return.
 */
export interface OrchestratorSignals {
  readonly tasksAcc: ReadableState<Task[]>
  readonly setTasks: (next: Task[]) => void
  readonly setActiveTaskSig: (next: string | null) => void
  readonly setUpdateSig: (next: UpdateInfo | null) => void
  readonly setDaemonVersionSig: (next: string | null) => void
  readonly engineStateAcc: ReadableState<ReadonlyMap<string, TaskEngineState>>
  readonly setEngineStateSig: (next: ReadonlyMap<string, TaskEngineState>) => void
  readonly engineTabStateAcc: ReadableState<EngineTabStateMap>
  readonly setEngineTabStateSig: (next: EngineTabStateMap) => void
  readonly setAttentionInboxSig: (next: readonly AttentionInboxItem[]) => void
  readonly taskJobsAcc: ReadableState<ReadonlyMap<string, TaskJobState>>
  readonly setTaskJobsSig: (next: ReadonlyMap<string, TaskJobState>) => void
  readonly worktreeChangesAcc: ReadableState<WorktreeChangesMap | null>
  readonly setWorktreeChangesSig: (next: WorktreeChangesMap | null) => void
  readonly usageSnapshotAcc: ReadableState<UsageSnapshotMap | null>
  readonly setUsageSnapshotSig: (next: UsageSnapshotMap | null) => void
  readonly contextUsageAcc: ReadableState<ContextUsageMap | null>
  readonly setContextUsageSig: (next: ContextUsageMap | null) => void
  readonly transcriptActivityAcc: ReadableState<TranscriptActivityMap | null>
  readonly setTranscriptActivitySig: (next: TranscriptActivityMap | null) => void
  readonly setNoticeSig: (next: NoticeEventPayload | null) => void
  readonly setTabOpenSig: (next: TabOpenPayload | null) => void
  readonly setTabCloseSig: (next: TabClosePayload | null) => void
  readonly setUiPromptSig: (next: UiPromptPayload | null) => void
  readonly engineLifecycleAcc: ReadableState<EngineLifecycleMap>
  readonly setEngineLifecycleSig: (next: EngineLifecycleMap) => void
  readonly setUiPrefsSig: (next: UiPrefsPayload | null) => void
  readonly setKeybindingsRevSig: (next: number | null) => void
  readonly setConnectionState: (next: DaemonConnectionState) => void
}

/**
 * How many failed attempts the pane reconnect loop keeps logging
 * (`orch-reconnect`) before it goes quiet. Issue #26: a daemon that stays
 * down for days with dozens of orphan panes each retrying forever was
 * still unbounded spam even at "attempt 1 and every 10th" — that decays
 * the RATE but never stops. A hard ceiling actually bounds it.
 */
export const RECONNECT_LOG_ATTEMPT_CEILING = 100

/**
 * Pure decision: should this failed reconnect attempt be logged? Attempt 1
 * and every 10th up to {@link RECONNECT_LOG_ATTEMPT_CEILING}; silent after
 * that until a successful reconnect resets the caller's attempt counter
 * back to 0. Exported for unit tests.
 */
export function shouldLogReconnectAttempt(attempt: number): boolean {
  if (attempt > RECONNECT_LOG_ATTEMPT_CEILING) return false
  return attempt === 1 || attempt % 10 === 0
}

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
    groupId: s.groupId,
    observedLanguage: s.observedLanguage,
    deletion: s.deletion,
    quotaResume: s.quotaResume,
    linkedWorkItem: s.linkedWorkItem,
    dispatcher: s.dispatcher,
    prompt: s.prompt,
    baseRef: s.baseRef,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  }
}
