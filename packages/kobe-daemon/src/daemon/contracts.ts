/** Framework-free product contracts consumed by the daemon package. */

import type { ObservedLanguage } from "../prompts/observed-language.ts"

/** Engine id (kobe `VendorId`). Deliberately plain `string`: the daemon
 *  treats vendor ids as opaque pass-through values and never narrows on
 *  the built-in literals — the old `"claude" | "codex" | "copilot" |
 *  (string & {})` union drifted from kobe's list (it missed `kimi`) AND
 *  its open string branch would have hidden the next drift inside an
 *  exhaustive-looking switch. Where the daemon DOES need the built-in
 *  list (plugin engine ids may not shadow a built-in or shipped-contrib
 *  engine), `plugins/manifest.ts` carries `RESERVED_ENGINE_IDS` as its
 *  own source of truth, locked to kobe's lists by a kobe-side test. */
export type VendorId = string
export type TaskStatus = "backlog" | "in_progress" | "in_review" | "done" | "canceled" | "error"

export interface TaskDeletionState {
  readonly phase: "queued" | "running" | "error"
  readonly force: boolean
  readonly requestedAt: string
  readonly error?: string
}

/** One engine-neutral quota window (mirrors kobe/types/engine.ts). */
export interface EngineQuotaWindow {
  readonly kind: string
  readonly label: string
  /** Integer utilization percent, 0..100. */
  readonly percent: number
  /** Epoch-ms window reset, or null when the vendor didn't report one. */
  readonly resetsAt: number | null
}

/** Snapshot of an engine account's quota windows (mirrors kobe/types/engine.ts). */
export interface EngineQuotaUsage {
  readonly windows: readonly EngineQuotaWindow[]
  readonly capturedAt: number
}

/** Durable rate-limit auto-resume schedule (mirrors kobe/types/task.ts). */
export interface TaskQuotaResumeState {
  /** ISO-8601 time the provider's exhausted quota window resets. */
  readonly resumeAt: string
  /** ISO-8601 time the rate limit was observed and this schedule written. */
  readonly requestedAt: string
}

export interface TaskPRStatus {
  readonly provider: "github" | "gitlab" | "bitbucket" | "unknown"
  readonly lifecycle: "creating" | "open" | "ready_to_merge" | "merged" | "closed" | "unknown"
  readonly checkState: "none" | "pending" | "passing" | "failing" | "unknown"
  readonly number?: number
  readonly url?: string
  readonly title?: string
  readonly baseRef?: string
  readonly headRef?: string
  readonly reviewDecision?: string
  readonly mergeable?: string
  readonly lastCheckedAt?: string
  readonly lastError?: string
}

/** The kobe session (task + tab) that dispatched a task's creation — the
 *  reply address a sub-task's bare `send` routes back to (mirrors
 *  kobe/types/task.ts). Absent when created outside a kobe session. */
export interface TaskDispatcher {
  readonly taskId: string
  readonly tabId: string
}

/** Pointer back to the external issue a task was started from. Snapshot for
 *  display; `url` is the durable way to the live item. Never synced. */
export interface TaskLinkedWorkItem {
  readonly provider: "github"
  readonly type: "issue" | "pr"
  readonly number: number
  readonly title: string
  readonly url: string
}

export interface DaemonTask {
  readonly id: string
  readonly title: string
  readonly repo: string
  readonly branch: string
  readonly worktreePath: string
  readonly kind?: "main" | "task" | "dir"
  /** Scratch shell task (issue #33): a dir task with no settled cwd, living
   *  in the sidebar's Scratch section; cleared when named or adopted. */
  readonly scratch?: boolean
  readonly status: TaskStatus
  readonly pinned?: boolean
  readonly vendor?: VendorId
  /** Raw engine launch command; `vendor` carries its resolved protocol. */
  readonly command?: string
  /** Language this task's user writes in, observed from their own prompts
   *  (`prompts/observed-language.ts`). Absent means English. */
  readonly observedLanguage?: ObservedLanguage
  readonly prStatus?: TaskPRStatus
  readonly position?: number
  readonly modelEffort?: string
  readonly groupId?: string
  readonly deletion?: TaskDeletionState
  readonly quotaResume?: TaskQuotaResumeState
  /** The external tracker item this task was started from, when it was. */
  readonly linkedWorkItem?: TaskLinkedWorkItem
  /** The kobe session (task + tab) that dispatched this task, when one did. */
  readonly dispatcher?: TaskDispatcher
  /** The task brief: the full text of the prompt `add --prompt` delivered
   *  into this task's engine, persisted so it survives the engine's own
   *  transcript. Verbatim, never truncated. Absent until delivered. */
  readonly prompt?: string
  /** The base ref the task branch was cut from (`add --base-branch`),
   *  persisted so branch signals measure against the real fork point.
   *  Absent on records that predate the field (signals fall back to a
   *  base guess). */
  readonly baseRef?: string
  readonly createdAt: string
  readonly updatedAt: string
}

/** Result of a `task.land` — mirrors the orchestrator's `LandResult`. */
export interface LandResult {
  readonly branch: string
  readonly strategy: "merge" | "squash"
  readonly landedOn: string
  readonly commit: string
  /** The post-land worktree cleanup outcome. Present unless removal was
   *  explicitly declined (`removeWorktree: false`). `reason` is not
   *  failure-only: it also rides with `removed: true` when the directory went
   *  but clearing the task's worktree path did not. */
  readonly worktree?: { readonly removed: boolean; readonly reason?: string }
  /** Ref anchoring a deleted branch's tip when nothing else reached it (the
   *  squash-land case). Absent on a `--no-ff` merge and when no branch was
   *  deleted. */
  readonly branchAnchor?: { readonly ref: string; readonly commit: string }
}

export interface AdoptableWorktree {
  readonly path: string
  readonly branch: string
  readonly head: string
  readonly dirty: boolean
  readonly kobeManaged: boolean
  readonly lastActivityMs: number
}

export interface DaemonOrchestrator {
  activeTaskSignal?(): (() => string | null) | undefined
  subscribeTasks(listener: (tasks: readonly DaemonTask[]) => void): () => void
  listTasks(): DaemonTask[]
  getTask(id: string): DaemonTask | undefined
  createTask(input: {
    repo: string
    title?: string
    branch?: string
    baseRef?: string
    vendor?: VendorId
    /** Raw engine launch command; `vendor` carries its resolved protocol. */
    command?: string
    modelEffort?: string
    groupId?: string
    dispatcher?: TaskDispatcher
  }): Promise<DaemonTask>
  ensureMainTask(repo: string): Promise<DaemonTask>
  /** Open an existing directory as a standalone `kind:"dir"` task (`kobe .`).
   *  `scratch` marks it a temp shell task for the sidebar's Scratch section. */
  openDirectoryTask(input: { dir: string; vendor?: VendorId; scratch?: boolean }): Promise<DaemonTask>
  /** Migrate a scratch task into `repo` (issue #33 adoption): repoint the
   *  task at the repo root and clear the scratch flag. */
  adoptScratchRepo(id: string, repo: string): Promise<void>
  ensureWorktree(id: string): Promise<string>
  forgetProject(repo: string): Promise<void>
  setTitle(id: string, title: string): Promise<void>
  setBranch(id: string, branch: string): Promise<void>
  /** Record the language a task's user writes in, from their own prompt text. */
  observeLanguage(id: string, text: string): Promise<void>
  setVendor(id: string, vendor: VendorId): Promise<void>
  /** Pin a raw launch command (and its caller-resolved protocol) on a task. */
  setCommand(id: string, command: string, vendor?: VendorId): Promise<void>
  setPinned(id: string, pinned?: boolean): Promise<void>
  moveTask(id: string, delta: -1 | 1): Promise<void>
  setStatus(id: string, status: TaskStatus): Promise<void>
  setPRStatus(id: string, status: TaskPRStatus | null): Promise<void>
  /** Stamp the external tracker item a task was started from. */
  setLinkedWorkItem(id: string, item: TaskLinkedWorkItem | null): Promise<void>
  /** Arm (or clear, with `null`) the rate-limit auto-resume schedule. */
  setQuotaResume(id: string, state: TaskQuotaResumeState | null): Promise<void>
  /** Record the task brief (the delivered `add --prompt` text) on the task. */
  setPrompt(id: string, prompt: string): Promise<void>
  reorderTasks(moves: ReadonlyArray<{ taskId: string; position: number }>): Promise<void>
  deleteTask(id: string, options?: { force?: boolean; deleteBranch?: boolean }): Promise<void>
  prepareTaskDeletion(id: string, options?: { force?: boolean; deleteBranch?: boolean }): Promise<boolean>
  beginTaskDeletion(id: string): Promise<boolean>
  finishTaskDeletion(id: string): Promise<void>
  landTask(
    id: string,
    options?: {
      strategy?: "merge" | "squash"
      deleteBranch?: boolean
      removeWorktree?: boolean
      callerCwd?: string
    },
  ): Promise<LandResult>
  setActiveTask(id: string | null): Promise<void>
  /** Clear a task's worktreePath (keep its branch) after an out-of-band worktree removal. */
  clearWorktreePath(id: string): Promise<void>
  discoverAdoptableWorktrees(repo: string): Promise<readonly AdoptableWorktree[]>
  adoptWorktree(input: {
    repo: string
    worktreePath: string
    branch?: string
    vendor?: VendorId
    title?: string
    ifExists: "return" | "error"
  }): Promise<DaemonTask>
}

export type EngineActivityKind =
  | "session-start"
  | "turn-start"
  | "turn-complete"
  | "turn-failed"
  | "turn-interrupted"
  | "awaiting-input"
  | "session-end"
  // Lifecycle-only kinds — plugin-facing, never folded into the activity badge.
  | "tool-pre"
  | "tool-post"
  | "tool-failed"
  | "pre-compact"
  | "post-compact"
  | "subagent-start"
  | "subagent-stop"

export interface EngineActivityDetail {
  readonly failure?: "rate_limit" | "billing" | "other"
  readonly waiting?: "permission" | "input"
  readonly tool?: { readonly name?: string; readonly id?: string }
  readonly compact?: { readonly trigger?: "manual" | "auto" }
  readonly subagent?: { readonly type?: string; readonly id?: string }
  readonly note?: string
  /**
   * For the `dead` state: how the engine process died, straight off the
   * pty-host's exit record. `code`/`signal` answer "who killed it" (143 =
   * 128+SIGTERM, an outside signal, not a self-exit) and `lastLine` is the
   * last non-blank line of the recorded tail — the 403 / auth / quota text
   * that was already on disk but reached no UI.
   */
  readonly exit?: {
    readonly code?: number | null
    readonly signal?: string | null
    readonly lastLine?: string
  }
  /**
   * Reference to a daemon-owned deferred-prompt record (issue #78 B-layer).
   * Present only on `prompt_deferred` inbox episodes. The prompt TEXT lives in
   * the DeferredPromptsStore, never here — this contract describes engine
   * activity, and a raw prompt is not engine activity.
   */
  readonly deferredPrompt?: {
    readonly id: string
    readonly layer: "recent-human-write" | "composer-not-empty"
  }
}

export type TaskActivityState =
  | "idle"
  | "running"
  | "turn_complete"
  | "rate_limited"
  | "permission_needed"
  | "error"
  /**
   * The engine PROCESS died — an exit record exists for the tab's session
   * (`pty-exits.json`). Distinct from `error`: `error` is an engine that ran
   * and reported a failed turn, `dead` is an engine that is no longer there.
   * A killed engine fires no hook at all, so this state can only ever be
   * written from the exit record, never from `reduceActivity`.
   */
  | "dead"

/**
 * The ENGINE half of a turn record (issue #32) — what the vendor's adapter
 * lifts from its own transcript. Mirrors `kobe/src/engine/agent-turn.ts`,
 * which is the contract's source of truth; this is the daemon's structural
 * copy (the daemon package never imports kobe sources).
 */
export interface AgentTurn {
  /** The engine's own stable turn id — dedupe key within a task. */
  readonly id: string
  readonly sessionId: string
  readonly model?: string
  /** Epoch ms. */
  readonly startedAt: number
  readonly endedAt: number
  readonly usage?: {
    readonly input_tokens?: number
    readonly output_tokens?: number
    readonly cache_read_input_tokens?: number
    readonly cache_creation_input_tokens?: number
  }
}

/**
 * One agent turn joined to Rove identity: the engine's turn plus the
 * task/tab/vendor/repo the daemon knows and the engine doesn't.
 */
export interface AgentTurnRecord extends Omit<AgentTurn, "sessionId"> {
  readonly taskId: string
  readonly tabId?: string
  readonly vendor?: VendorId
  readonly sessionId?: string
  /** Source repo of the task, so a digest can scope by project. */
  readonly repo?: string
}

/** States represented by pending Inbox items until handled or the same
 * Terminal Tab starts another turn. Deliberately NOT a subset of
 * {@link TaskActivityState}: `prompt_deferred` is a queue/ownership state (a
 * prompt the daemon accepted but could not paste), not an engine activity —
 * the engine may be idle while a deferred prompt waits for release. */
export const ATTENTION_INBOX_STATES = [
  "turn_complete",
  "permission_needed",
  "error",
  "rate_limited",
  "prompt_deferred",
  /** The engine PROCESS died (pty-host exit record). An episode a user must
   *  see: nothing else in the queue tells them the agent is simply gone. */
  "dead",
] as const

export type AttentionInboxState = (typeof ATTENTION_INBOX_STATES)[number]

export function isAttentionInboxState(value: unknown): value is AttentionInboxState {
  return typeof value === "string" && (ATTENTION_INBOX_STATES as readonly string[]).includes(value)
}

export function attentionInboxItemKey(item: { taskId: string | null; tabId: string | null }): string {
  return `${item.taskId}\0${item.tabId ?? ""}`
}

/** One daemon-owned, durable attention episode for a task's engine tab. */
export interface AttentionInboxItem {
  readonly taskId: string
  /** `null` for hook events that predate or lack a tab identity. */
  readonly tabId: string | null
  readonly state: AttentionInboxState
  readonly detail?: EngineActivityDetail
  /** Compatibility field ignored by the queue model; new episodes set it to `true`. */
  readonly unread: boolean
  /** Event time, epoch milliseconds. Stable across daemon/TUI restarts. */
  readonly at: number
}

/** A shell command run BEFORE an automation's engine starts. A non-zero exit
 *  means "nothing to do" and the run is skipped without spawning an engine —
 *  the cheap way to stop a schedule burning a turn when nothing changed. */
export interface AutomationPrecheck {
  readonly command: string
  readonly timeoutSeconds: number
}

/**
 * One scheduled agent task: a cron rule + a prompt + a repo. Every firing
 * creates a FRESH task (worktree + branch + engine session), so an automation
 * run is an ordinary task you can open and keep talking to.
 *
 * `nextRunAt` is the whole scheduling story: an absolute timestamp on disk,
 * never an in-memory timer. A daemon restart needs no re-arm pass — the first
 * sweep after boot re-reads it (same shape as `Task.quotaResume`).
 */
export interface Automation {
  readonly id: string
  readonly name: string
  /** Absolute repo root; resolved once at create time. */
  readonly repo: string
  /** Delivered as the engine's launch-time first message. */
  readonly prompt: string
  readonly vendor?: VendorId
  /** Five-field cron, evaluated in the daemon host's local time. */
  readonly schedule: string
  readonly precheck?: AutomationPrecheck
  readonly baseRef?: string
  readonly enabled: boolean
  /** ISO-8601. The single source of truth for when this fires next. */
  readonly nextRunAt: string
  /** How late a missed occurrence may still run. Older ones are skipped. */
  readonly missedRunGraceMinutes: number
  readonly lastRunAt?: string
  readonly createdAt: string
  readonly updatedAt: string
}

/**
 * Why a run did or did not produce work. The four "didn't run" reasons are
 * deliberately distinct: unattended automation is only trustworthy if the user
 * can tell "nothing to do" (`skipped_precheck`, healthy) from "it broke"
 * (`dispatch_failed`, needs a human) at a glance.
 */
export type AutomationRunStatus =
  | "dispatched"
  | "skipped_precheck"
  | "skipped_missed"
  | "skipped_unavailable"
  | "dispatch_failed"

export interface AutomationPrecheckResult {
  readonly exitCode: number | null
  readonly timedOut: boolean
  readonly stdout: string
  readonly stderr: string
  readonly durationMs: number
}

export interface AutomationRun {
  readonly id: string
  readonly automationId: string
  /** Monotonic per automation; survives retention pruning. */
  readonly runNumber: number
  /** When this occurrence was SUPPOSED to run — not when it actually did. */
  readonly scheduledFor: string
  readonly status: AutomationRunStatus
  readonly trigger: "scheduled" | "manual"
  readonly taskId?: string
  readonly precheckResult?: AutomationPrecheckResult
  readonly error?: string
  /** ISO-8601 event time. */
  readonly at: string
}

/** Mutable fields of an automation. `schedule` changes recompute `nextRunAt`. */
export interface AutomationPatch {
  readonly name?: string
  readonly prompt?: string
  readonly vendor?: VendorId
  readonly schedule?: string
  readonly precheck?: AutomationPrecheck | null
  readonly baseRef?: string | null
  readonly enabled?: boolean
  readonly missedRunGraceMinutes?: number
}

export interface UpdateInfo {
  readonly current: string
  readonly latest: string
  readonly hasUpdate: boolean
}

export interface WorktreeChanges {
  readonly added: number
  readonly deleted: number
}
