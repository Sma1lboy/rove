/**
 * Browser-side mirrors of the daemon's wire types. Defined locally (not
 * imported from the kobe package) so no server code leaks into the client
 * bundle — these must stay in sync with
 * packages/kobe-daemon/src/daemon/protocol.ts (SerializedTask + ChannelPayloads).
 *
 * The issue types are the exception: the daemon publishes them structurally
 * unchanged over `issue.snapshot`, so this re-exports the store's own
 * declaration instead of mirroring it (`lib/issues.ts` is the other door to
 * the same type).
 */

import type { RepoIssues } from "@sma1lboy/kobe-daemon/daemon/issues-store"

export type {
  Issue,
  IssueStatus,
  RepoIssues,
} from "@sma1lboy/kobe-daemon/daemon/issues-store"

export type TaskKind = "main" | "task" | "dir"
export type TaskStatus = string
export type Vendor = string | undefined

/** Mirror of the daemon's TaskPRStatus (types/task.ts) — only the fields
 *  the web rail renders are typed; the rest pass through untouched. */
export interface TaskPRStatus {
  provider?: string
  lifecycle?:
    | "creating"
    | "open"
    | "ready_to_merge"
    | "merged"
    | "closed"
    | "unknown"
  checkState?: "none" | "pending" | "passing" | "failing" | "unknown"
  number?: number
  url?: string
}

export interface Task {
  id: string
  title: string
  repo: string
  branch: string
  worktreePath: string
  kind: TaskKind
  status: TaskStatus
  pinned: boolean
  vendor?: Vendor
  prStatus?: TaskPRStatus
  /** Web-board ordering key (sparse fractional; absent until first drop). */
  position?: number
  /** Selected reasoning/effort level for the task's engine (mirrors the
   *  daemon's SerializedTask.modelEffort) — surfaced in the issue detail
   *  drawer's engine+effort picker. The task does not reverse-reference its
   *  issue; the issue→task link lives on {@link Issue.taskId}. */
  modelEffort?: string
  deletion?: {
    phase: "queued" | "running" | "error"
    force: boolean
    requestedAt: string
    error?: string
  }
  createdAt: string
  updatedAt: string
}

/** Transient engine activity (what the agent is doing right now). */
export type ActivityState =
  | "idle"
  | "running"
  | "waiting_permission"
  | "rate_limited"
  | "error"
  | string

export interface EngineState {
  taskId: string
  state: ActivityState
  detail?: unknown
  at: number
}

export interface UpdateInfo {
  latest?: string
  current?: string
  [k: string]: unknown
}

/** Lifecycle progress of a minute-class daemon job on one task
 *  (today: `task.ensureWorktree` materializing a worktree). */
export interface TaskJob {
  taskId: string
  kind: string
  phase: "running" | "done" | "error"
  error?: string
}

/** worktreePath → uncommitted change counts (daemon-collected). */
export type WorktreeChangeCounts = Record<
  string,
  { added: number; deleted: number }
>

/** One "paste this into task X" event (mirror of the daemon's
 *  `session.deliver` channel; docs/design/dispatcher.md). The SPA is the
 *  front-end that hosts web sessions, so it owns the actual delivery —
 *  see lib/dispatch-delivery.ts. `at` is the dedupe key. */
export interface SessionDeliver {
  taskId: string
  text: string
  /** Exact terminal tab to deliver into (`dispatch --tab`); absent = the
   *  canonical engine tab. */
  tabId?: string
  at: number
  source: "note" | "dispatcher"
}

/** The user's persisted visual prefs, fanned out by the daemon's
 *  state.json watcher (mirror of the `ui-prefs` channel payload). */
export interface UiPrefs {
  theme: string
  transparentBackground: boolean
  focusAccent: string | null
  sortMode: "default" | "recent"
  keysCollapsed: boolean
  projectFilter?: string | null
}

/** Channel push, as the daemon web transport serializes it over SSE. */
export type WebTransportEvent =
  | { channel: "task.snapshot"; payload: { tasks: Task[] } }
  | { channel: "issue.snapshot"; payload: RepoIssues }
  | { channel: "active-task"; payload: { taskId: string | null } }
  | { channel: "engine-state"; payload: EngineState }
  | { channel: "update"; payload: { info: UpdateInfo | null } }
  | { channel: "task.jobs"; payload: TaskJob }
  | { channel: "worktree.changes"; payload: { changes: WorktreeChangeCounts } }
  | { channel: "session.deliver"; payload: SessionDeliver }
  | { channel: "ui-prefs"; payload: UiPrefs }

/** Full bootstrap state the daemon web transport sends on connect. */
export interface WebTransportSnapshot {
  tasks: Task[]
  activeTaskId: string | null
  engineStates: Record<string, EngineState>
  update: UpdateInfo | null
  /** taskId -> in-flight job (running only; terminal phases are dropped). */
  jobs?: Record<string, TaskJob>
  worktreeChanges?: WorktreeChangeCounts
  /** repoRoot → daemon-owned issue state replayed by `issue.snapshot` (web
   *  Issues page). */
  issueSnapshots?: Record<string, RepoIssues>
  /** Most recent session.deliver event — replayed to late browsers; the
   *  forwarder dedupes on `at`. */
  deliver?: SessionDeliver | null
  uiPrefs?: UiPrefs | null
  connected: boolean
}
