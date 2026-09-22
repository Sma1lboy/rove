/** Framework-free product contracts consumed by the daemon package. */

import type { ObservedLanguage } from "../prompts/observed-language.ts"
import type { TaskRoutineLink } from "./automation-contracts.ts"

// Re-exported so importers keep naming them through `contracts.ts`.
export type {
  Automation,
  AutomationPatch,
  AutomationPrecheck,
  AutomationPrecheckResult,
  AutomationRun,
  AutomationRunStatus,
  TaskRoutineLink,
} from "./automation-contracts.ts"
export { automationRunNeedsAttention } from "./automation-contracts.ts"

// Engine activity + the attention Inbox, likewise.
export type {
  AttentionInboxItem,
  AttentionInboxState,
  EngineActivityDetail,
  EngineActivityKind,
  TaskActivityState,
} from "./attention-contracts.ts"
export { ATTENTION_INBOX_STATES, attentionInboxItemKey, isAttentionInboxState } from "./attention-contracts.ts"

/** Engine id (kobe `VendorId`), opaque to the daemon. Plain `string`: a
 *  literal union with `(string & {})` drifts from kobe's list and hides the
 *  drift inside an exhaustive-looking switch. The built-in list the daemon
 *  needs (plugin ids may not shadow one) is `plugins/manifest.ts`
 *  `RESERVED_ENGINE_IDS`, locked to kobe's by a kobe-side test. */
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

/**
 * A worker's own outcome claim (mirrors kobe/types/task.ts).
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

/** Session (task + tab) that dispatched a task: where a sub-task's bare
 *  `send` routes back (mirrors kobe/types/task.ts). */
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
  /** Dir task with no settled cwd (sidebar Scratch section); cleared when named or adopted. */
  readonly scratch?: boolean
  /** The one task a `persistentSession` automation re-delivers into; folded
   *  behind a count row in the sidebar. */
  readonly routine?: TaskRoutineLink
  readonly status: TaskStatus
  readonly pinned?: boolean
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
  /** Auto-effort tier the engine fields were filled from, when one was. */
  readonly tier?: string
  readonly groupId?: string
  readonly deletion?: TaskDeletionState
  readonly quotaResume?: TaskQuotaResumeState
  /** The external tracker item this task was started from, when it was. */
  readonly linkedWorkItem?: TaskLinkedWorkItem
  /** The kobe session (task + tab) that dispatched this task, when one did. */
  readonly dispatcher?: TaskDispatcher
  /** The `add --prompt` brief as delivered, verbatim, never truncated; outlives
   *  the engine transcript. Absent until delivered. */
  readonly prompt?: string
  /** Ref the branch was cut from (`add --base-branch`), so branch signals use
   *  the real fork point. Absent on older records (signals guess a base). */
  readonly baseRef?: string
  /** `add --worktree-name`; absent = drawn from the animal pool. */
  readonly worktreeName?: string
  /** The WORKER's own account of what it delivered (`set-status --report-*`).
   *  A claim, unlike `prStatus`, which the daemon observed from the forge. */
  readonly report?: TaskWorkerReport
  readonly createdAt: string
  readonly updatedAt: string
}

/**
 * Result of a `task.landPreflight` — the read-only "may this land, and into
 * what" probe. Mirrors the orchestrator's `LandPreflight`. `refusal` set means
 * the land would be refused for that reason; absent means it may proceed.
 */
export interface LandPreflightResult {
  readonly branch: string
  /** The merge destination: the base checkout's current branch. Empty only
   *  under the detached-HEAD refusal, where there is no branch to name. */
  readonly landedOn: string
  /** Commits on `branch` the destination does not have. Absent — never a
   *  fabricated zero — when git could not count them. */
  readonly ahead?: number
  readonly baseDirty?: boolean
  readonly refusal?:
    | "DETACHED_HEAD"
    | "UNREADABLE_BASE"
    | "UNBORN_BASE"
    | "SAME_BRANCH"
    | "MAIN_CHECKOUT_DIRTY"
    | "MISSING_REF"
    | "EMPTY_BRANCH"
    | "EMPTY_BRANCH_DIRTY_WORKTREE"
  /** Uncommitted paths in the task's worktree — only with `EMPTY_BRANCH_DIRTY_WORKTREE`. */
  readonly dirtyFiles?: readonly string[]
  readonly baseDir: string
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
  readonly worktree?: {
    readonly removed: boolean
    readonly reason?: string
    /** Set when git deregistered the worktree but could not delete its
     *  directory — the land and its cleanup both succeeded; a directory is
     *  left on disk that Rove will never list again. */
    readonly residue?: { readonly path: string; readonly reason: string }
  }
  /** Ref anchoring a deleted branch's tip when nothing else reached it (the
   *  squash-land case). Absent on a `--no-ff` merge and when no branch was
   *  deleted. */
  readonly branchAnchor?: { readonly ref: string; readonly commit: string }
  /** Set when `--delete-branch` was asked for and the branch was kept anyway,
   *  because its worktree is still on disk with the branch checked out — git
   *  would refuse the delete. `reason` is why the worktree stayed. */
  readonly branchKept?: { readonly reason: string }
}

export interface AdoptableWorktree {
  readonly path: string
  readonly branch: string
  readonly head: string
  /** `null` = the `git status` probe FAILED (unreadable `.git`, worktree
   *  gone mid-scan), not "clean". A worktree holding uncommitted work whose
   *  status answers "Permission denied" must not be reported as `false`. */
  readonly dirty: boolean | null
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
  }): Promise<DaemonTask>
  ensureMainTask(repo: string): Promise<DaemonTask>
  /** Open an existing directory as a standalone `kind:"dir"` task (`kobe .`).
   *  `scratch` marks it a temp shell task for the sidebar's Scratch section. */
  openDirectoryTask(input: { dir: string; vendor?: VendorId; scratch?: boolean }): Promise<DaemonTask>
  /** Migrate a scratch task into `repo`: repoint the
   *  task at the repo root and clear the scratch flag. */
  adoptScratchRepo(id: string, repo: string): Promise<void>
  ensureWorktree(id: string): Promise<string>
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
  moveTask(id: string, delta: -1 | 1): Promise<void>
  setStatus(id: string, status: TaskStatus): Promise<void>
  /** Record what the worker says it delivered (`set-status --report-*`).
   *  Separate from `setStatus` because a report on an already-`done` task is
   *  ordinary, and `setStatus` returns early when the status is unchanged. */
  setWorkerReport(id: string, report: Omit<TaskWorkerReport, "at">): Promise<void>
  setPRStatus(id: string, status: TaskPRStatus | null): Promise<void>
  /** Stamp the external tracker item a task was started from. */
  setLinkedWorkItem(id: string, item: TaskLinkedWorkItem | null): Promise<void>
  /** Arm (or clear, with `null`) the rate-limit auto-resume schedule. */
  setQuotaResume(id: string, state: TaskQuotaResumeState | null): Promise<void>
  /** Record the task brief (the delivered `add --prompt` text) on the task. */
  setPrompt(id: string, prompt: string): Promise<void>
  deleteTask(id: string, options?: { force?: boolean; deleteBranch?: boolean }): Promise<void>
  prepareTaskDeletion(id: string, options?: { force?: boolean; deleteBranch?: boolean }): Promise<boolean>
  beginTaskDeletion(id: string): Promise<boolean>
  finishTaskDeletion(id: string): Promise<void>
  /** Read-only land probe — no writes; see {@link LandPreflightResult}. */
  landPreflight(id: string): Promise<LandPreflightResult>
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

/**
 * Engine half of a turn record, lifted from the vendor transcript. Structural
 * copy of `kobe/src/engine/agent-turn.ts` (source of truth); the daemon never
 * imports kobe sources.
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
 * kobe's `EngineUsageSnapshot` (`kobe/src/types/engine.ts`, source of truth);
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
