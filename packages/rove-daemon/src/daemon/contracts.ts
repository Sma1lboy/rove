/** Framework-free product contracts consumed by the daemon package. */

import type { ObservedLanguage } from "../prompts/observed-language.ts"
import type { TaskRoutineLink } from "./automation-contracts.ts"
import type { MigratedChildInput, SpawnChildInput, SpawnChildResult, TaskDeleteOptions } from "./child-contracts.ts"
import type { LandPreflightResult, LandResult } from "./land-contracts.ts"

// Re-exported so importers keep naming them through `contracts.ts`.
export type {
  Automation,
  AutomationPatch,
  AutomationPrecheck,
  AutomationPrecheckResult,
  AutomationRun,
  AutomationRunResponse,
  AutomationRunStatus,
  AutomationTrigger,
  TaskRoutineLink,
} from "./automation-contracts.ts"
export {
  ROUTINE_RESPONSE_MAX_CHARS,
  ROUTINE_RESPONSE_WINDOW_MS,
  automationRunNeedsAttention,
  routineRunResponseState,
} from "./automation-contracts.ts"

// Engine activity + the attention Inbox, likewise.
export type {
  AttentionInboxItem,
  AttentionInboxState,
  EngineActivityDetail,
  EngineActivityKind,
  TaskActivityState,
} from "./attention-contracts.ts"
export {
  ATTENTION_INBOX_STATES,
  attentionInboxItemKey,
  isAttentionInboxState,
  isRoutineInboxState,
} from "./attention-contracts.ts"

// Deliveries (armed prompts that owe a report).
export type {
  Delivery,
  DeliveryMissingCause,
  DeliveryOutcome,
  DeliveryReport,
  DeliverySource,
  DeliveryStatus,
} from "./delivery-contracts.ts"
export {
  DELIVERY_OUTCOMES,
  DELIVERY_STALL_MS,
  DELIVERY_SUMMARY_MAX_CHARS,
  MAX_DELIVERIES_PER_TASK,
  deliveryFooter,
} from "./delivery-contracts.ts"
// Should-run verdicts.
export type { RunnabilityVerdict, SkipReason, SkipVerdict } from "./runnability-contracts.ts"
export { SHOULD_RUN_SKIP_EXIT_CODE, SKIP_REASONS } from "./runnability-contracts.ts"
// Decision gates, likewise.
export type {
  Gate,
  GateAnswer,
  GateAnswerSurface,
  GateInboxDetail,
  GateOption,
  GateStatus,
  GatesPayload,
} from "./gate-contracts.ts"
// Land and sync results, likewise.
export type {
  LandPreflightResult,
  LandRepoPreflight,
  LandRepoResult,
  LandRepoStatus,
  LandResult,
  SyncRepoResult,
  SyncReposResult,
} from "./land-contracts.ts"

/** Engine id (rove `VendorId`), opaque to the daemon. Plain `string`: a
 *  literal union with `(string & {})` drifts from rove's list and hides the
 *  drift inside an exhaustive-looking switch. The built-in list the daemon
 *  needs (plugin ids may not shadow one) is `plugins/manifest.ts`
 *  `RESERVED_ENGINE_IDS`, locked to rove's by a rove-side test. */
export type VendorId = string
export type TaskStatus = "backlog" | "in_progress" | "in_review" | "done" | "canceled" | "error"

export interface TaskDeletionState {
  readonly phase: "queued" | "running" | "error"
  readonly force: boolean
  /** Opt-in: also delete the task's git branch. Default (absent/false) keeps
   *  the branch — git history is the durable record, the task row is not. */
  readonly deleteBranch?: boolean
  readonly requestedAt: string
  readonly error?: string
}

/** One engine-neutral quota window (mirrors rove/types/engine.ts). */
export interface EngineQuotaWindow {
  readonly kind: string
  readonly label: string
  /** Integer utilization percent, 0..100. */
  readonly percent: number
  /** Epoch-ms window reset, or null when the vendor didn't report one. */
  readonly resetsAt: number | null
}

/** Snapshot of an engine account's quota windows (mirrors rove/types/engine.ts). */
export interface EngineQuotaUsage {
  readonly windows: readonly EngineQuotaWindow[]
  readonly capturedAt: number
}

/** Durable rate-limit auto-resume schedule (mirrors rove/types/task.ts). */
export interface TaskQuotaResumeState {
  /** ISO-8601 time the provider's exhausted quota window resets. */
  readonly resumeAt: string
  /** ISO-8601 time the rate limit was observed and this schedule written. */
  readonly requestedAt: string
}

/**
 * A worker's own outcome claim (mirrors rove/types/task.ts).
 *
 * Kept apart from {@link TaskPRStatus} on purpose: this is what the worker
 * SAID, that is what the daemon OBSERVED by polling the forge. A dispatcher
 * deciding whether to land needs to know which of the two it is holding.
 */
export interface TaskWorkerReport {
  readonly branch?: string
  readonly pr?: number
  readonly summary?: string
  /** ISO-8601 time the report was written. */
  readonly at: string
}

export interface TaskPRStatus {
  readonly provider: "github" | "gitlab" | "bitbucket" | "unknown"
  readonly lifecycle: "creating" | "open" | "ready_to_merge" | "merged" | "closed" | "unknown"
  readonly checkState: "none" | "pending" | "passing" | "failing" | "unknown"
  readonly number?: number
  readonly url?: string
  readonly title?: string
  readonly baseRef?: string
  readonly reviewDecision?: string
  readonly mergeable?: string
  readonly lastCheckedAt?: string
  readonly lastError?: string
}

/**
 * A secondary repo of a multi-repo task: its own worktree on the task's shared
 * branch name (mirrors rove/types/task.ts). The primary lives in the task's
 * own `repo`/`branch`/`worktreePath`.
 */
export interface TaskExtraRepo {
  /** Handle unique within the task; `get-task` lists it and `--base-for` keys on it. */
  readonly name: string
  /** Absolute git root. */
  readonly repo: string
  /** Actual branch in this repo: the task's branch unless it collided here. "" until materialised. */
  readonly branch: string
  /** "" until materialised. */
  readonly worktreePath: string
  readonly baseRef?: string
  /** This repo's PR, polled from its own remote (the primary's lives on the task's `prStatus`). */
  readonly prStatus?: TaskPRStatus
}

/** Session (task + tab) that dispatched a task: where a sub-task's bare
 *  `send` routes back (mirrors rove/types/task.ts). */
export interface TaskDispatcher {
  readonly taskId: string
  readonly tabId: string
}

/** A migrated child whose conversation is still the live hosted PTY keyed
 *  `<taskId>::<tabId>` under its parent (mirrors rove/types/task.ts). */
export interface TaskPtyAlias {
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
  /** Dir task with no settled cwd (sidebar Scratch section); cleared when named or adopted. */
  readonly scratch?: boolean
  /** Dir task a projectless routine made; sorts into the Ungrouped group with Scratch. */
  readonly noProject?: boolean
  /** The one task a `persistentSession` automation re-delivers into; folded
   *  behind a count row in the sidebar. */
  readonly routine?: TaskRoutineLink
  readonly status: TaskStatus
  readonly pinned?: boolean
  readonly archived?: boolean
  readonly vendor?: VendorId
  /** Raw engine launch command; `vendor` carries its resolved protocol. */
  readonly command?: string
  /** Language this task's user writes in, observed from their own prompts
   *  (`prompts/observed-language.ts`). Absent means English. */
  readonly observedLanguage?: ObservedLanguage
  readonly prStatus?: TaskPRStatus
  readonly modelEffort?: string
  /** Model pinned on the engine, in its own spelling. */
  readonly model?: string
  /** Auto-routing tier the engine fields were filled from, when one was. */
  readonly tier?: string
  readonly groupId?: string
  readonly deletion?: TaskDeletionState
  readonly quotaResume?: TaskQuotaResumeState
  /** The external tracker item this task was started from, when it was. */
  readonly linkedWorkItem?: TaskLinkedWorkItem
  /** The rove session (task + tab) that dispatched this task, when one did. */
  readonly dispatcher?: TaskDispatcher
  /** Tree lineage: the task this one was spawned from. Distinct from `dispatcher` (report routing). */
  readonly parentTaskId?: string
  /** Set on a child running in another task's directory (that task = the workspace owner). */
  readonly sharesWorkspaceOf?: string
  /** Engine cwd relative to `worktreePath` (a child spawned from a git subdirectory). */
  readonly cwdSubpath?: string
  /** Present only on a migrated child whose live hosted PTY is still keyed under its parent. */
  readonly ptyAlias?: TaskPtyAlias
  /** Every prompt sent to this task arms a delivery that must end in `rove api report`. */
  readonly requireReport?: boolean
  /** The `add --prompt` brief as delivered, verbatim, never truncated; outlives
   *  the engine transcript. Absent until delivered. */
  readonly prompt?: string
  /** Ref the branch was cut from (`add --base-branch`), so branch signals use
   *  the real fork point. Absent on older records (signals guess a base). */
  readonly baseRef?: string
  /** `add --worktree-name`; absent = drawn from the animal pool. */
  readonly worktreeName?: string
  /** Secondary repos of a multi-repo task, in pick order (the primary is `repo`). */
  readonly extraRepos?: readonly TaskExtraRepo[]
  /** The WORKER's own account of what it delivered (`update --report-*`).
   *  A claim, unlike `prStatus`, which the daemon observed from the forge. */
  readonly report?: TaskWorkerReport
  readonly createdAt: string
  readonly updatedAt: string
}

export interface AdoptableWorktree {
  readonly path: string
  readonly branch: string
  readonly head: string
  /** `null` = the `git status` probe FAILED (unreadable `.git`, worktree
   *  gone mid-scan), not "clean". A worktree holding uncommitted work whose
   *  status answers "Permission denied" must not be reported as `false`. */
  readonly dirty: boolean | null
  readonly roveManaged: boolean
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
    worktreeName?: string
    vendor?: VendorId
    /** Raw engine launch command; `vendor` carries its resolved protocol. */
    command?: string
    modelEffort?: string
    model?: string
    tier?: string
    groupId?: string
    dispatcher?: TaskDispatcher
    /** Mark this the standing session task of a routine. */
    routine?: TaskRoutineLink
    /** Secondary repos in pick order; `baseRef` is that repo's own fork point. */
    extraRepos?: readonly { readonly repo: string; readonly baseRef?: string }[]
  }): Promise<DaemonTask>
  ensureMainTask(repo: string): Promise<DaemonTask>
  /** Open an existing directory as a standalone `kind:"dir"` task (`rove .`).
   *  `scratch` marks it a temp shell task for the sidebar's Scratch section. */
  openDirectoryTask(input: {
    dir: string
    vendor?: VendorId
    scratch?: boolean
    /** Projectless routine session: sorts into the Ungrouped group, never promoted to a project. */
    noProject?: boolean
    /** Explicit title; absent mints `<dir>-<suffix>` (scratch: empty). */
    title?: string
    model?: string
    modelEffort?: string
    routine?: TaskRoutineLink
  }): Promise<DaemonTask>
  /** Migrate a scratch task into `repo`: repoint the
   *  task at the repo root and clear the scratch flag. */
  adoptScratchRepo(id: string, repo: string): Promise<void>
  ensureWorktree(id: string, opts?: { onProgress?: (percent: number) => void }): Promise<string>
  forgetProject(repo: string): Promise<void>
  setTitle(id: string, title: string): Promise<void>
  setBranch(id: string, branch: string): Promise<void>
  /** Record the language a task's user writes in, from their own prompt text. */
  observeLanguage(id: string, text: string): Promise<void>
  /** `effort`: absent = keep the recorded level, `""` = clear it, else set it. */
  setVendor(id: string, vendor: VendorId, effort?: string, model?: string): Promise<void>
  /** Pin a raw launch command (and its caller-resolved protocol) on a task. */
  setCommand(id: string, command: string, vendor?: VendorId): Promise<void>
  setPinned(id: string, pinned?: boolean): Promise<void>
  /** Archive or restore ONE task row; the cascade over its descendants is the caller's. */
  setArchived(id: string, archived: boolean): Promise<void>
  setRequireReport(id: string, required: boolean): Promise<void>
  moveTask(id: string, delta: -1 | 1): Promise<void>
  moveTaskToTop(id: string): Promise<void>
  setStatus(id: string, status: TaskStatus): Promise<void>
  /** Record what the worker says it delivered (`update --report-*`).
   *  Separate from `setStatus` because a report on an already-`done` task is
   *  ordinary, and `setStatus` returns early when the status is unchanged. */
  setWorkerReport(id: string, report: Omit<TaskWorkerReport, "at">): Promise<void>
  setPRStatus(id: string, status: TaskPRStatus | null, repoName?: string): Promise<void>
  /** Stamp the external tracker item a task was started from. */
  setLinkedWorkItem(id: string, item: TaskLinkedWorkItem | null): Promise<void>
  /** Arm (or clear, with `null`) the rate-limit auto-resume schedule. */
  setQuotaResume(id: string, state: TaskQuotaResumeState | null): Promise<void>
  /** Record the task brief (the delivered `add --prompt` text) on the task. */
  setPrompt(id: string, prompt: string): Promise<void>
  deleteTask(id: string, options?: TaskDeleteOptions): Promise<void>
  /** Persist the deletion request(s) after the dirty-worktree gate; `cascade` queues the whole subtree. */
  prepareTaskDeletion(id: string, options?: TaskDeleteOptions): Promise<boolean>
  /** Spawn a child task of `input.parentTaskId` (see {@link SpawnChildInput}). */
  spawnChildTask(input: SpawnChildInput): Promise<SpawnChildResult>
  /** Add a shared child for a migrated engine tab; never materialises a worktree. */
  createMigratedChild(input: MigratedChildInput): Promise<DaemonTask>
  /** Set the PTY alias of a migrated child, or clear it (`null`) once that PTY is gone. */
  setPtyAlias(id: string, alias: TaskPtyAlias | null): Promise<void>
  beginTaskDeletion(id: string): Promise<boolean>
  finishTaskDeletion(id: string): Promise<void>
  /** Read-only land probe — no writes; see {@link LandPreflightResult}. */
  landPreflight(id: string, repo?: string): Promise<LandPreflightResult>
  landTask(
    id: string,
    options?: {
      strategy?: "merge" | "squash"
      deleteBranch?: boolean
      removeWorktree?: boolean
      callerCwd?: string
      /** Only this repo of a multi-repo task (its name from `extraRepos[].name`). */
      repo?: string
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

/**
 * Engine half of a turn record, lifted from the vendor transcript. Structural
 * copy of `rove/src/engine/agent-turn.ts` (source of truth); the daemon never
 * imports rove sources.
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

export interface UpdateInfo {
  readonly current: string
  readonly latest: string
  readonly hasUpdate: boolean
}

/**
 * Context half of one live session's usage snapshot. Structural mirror of
 * rove's `EngineUsageSnapshot` (`rove/src/types/engine.ts`, source of truth);
 * the engine's history reader computes it, never the daemon (vendor arithmetic).
 *
 * An unreported token count is absent, never `0`: "used no cache" and "engine
 * doesn't say" must stay distinguishable.
 */
export interface EngineContextUsage {
  /** Tokens currently in the session's context window. */
  readonly contextTokens: number
  /** The model's context window, when the vendor reports one. */
  readonly contextWindowTokens?: number
  /** True when `contextTokens` is estimated rather than engine-reported. */
  readonly approximate?: boolean
  /** Prompt tokens billed across the whole session, when the vendor reports them. */
  readonly inputTokens?: number
  /** Completion tokens across the whole session, when the vendor reports them. */
  readonly outputTokens?: number
  /** Cache-read tokens across the whole session, when the vendor reports them. */
  readonly cacheReadTokens?: number
  /** Cache-write tokens across the whole session, when the vendor reports them. */
  readonly cacheCreationTokens?: number
}

export interface WorktreeChanges {
  readonly added: number
  readonly deleted: number
  /** `git rev-list --count HEAD..<base>`. Absent, never a fabricated zero,
   *  when no base ref resolves (no remote and no `main`/`master`). */
  readonly behind?: number
  /**
   * Right half of `git rev-list --left-right --count <base>...HEAD`; absent
   * exactly when `behind` is (same process). The only number separating a
   * clean worktree that committed (`ahead > 0`) from one that delivered
   * nothing (`0`), which otherwise surfaces only at land time as `EMPTY_BRANCH`.
   */
  readonly ahead?: number
}
