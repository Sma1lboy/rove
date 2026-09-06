/**
 * Row codec: ONE persisted JSON entry → a v3 {@link Task}.
 *
 * The seam against `store-codec.ts` is scope. That file works at MANIFEST
 * level — lock retry, corrupt/unsupported-version recovery, the read-merge-
 * write protocol — and it is where a bug costs you the whole index. This one
 * never sees the file: it takes an arbitrary parsed value and answers with a
 * task or `null`, so tolerating a v1/v2 shape, a dropped field, or a
 * half-written row is checkable one field at a time.
 *
 * `normalizeIndex` in `store-codec.ts` is the only caller.
 */

import type {
  Task,
  TaskDeletionState,
  TaskDispatcher,
  TaskLinkedWorkItem,
  TaskPRStatus,
  TaskQuotaResumeState,
  TaskRoutineLink,
  TaskStatus,
  TaskWorkerReport,
} from "../../types/task.ts"
import { toTaskId } from "../../types/task.ts"
import { coerceVendorId } from "../../types/vendor.ts"

/**
 * Coerce one persisted task entry into a v3 {@link Task}. Tolerant of
 * v1 / v2 shapes — silently drops the dropped fields.
 */
export function coerceTask(value: unknown): Task | null {
  if (!value || typeof value !== "object") return null
  const v = value as Record<string, unknown>
  if (
    typeof v.id !== "string" ||
    typeof v.title !== "string" ||
    typeof v.repo !== "string" ||
    typeof v.branch !== "string" ||
    typeof v.worktreePath !== "string" ||
    typeof v.status !== "string" ||
    typeof v.createdAt !== "string" ||
    typeof v.updatedAt !== "string"
  ) {
    return null
  }
  if (!isTaskStatus(v.status)) return null

  // A `main` (project root) task has NO session lifecycle that maintains
  // its status — nothing ever flips it to in_progress on a turn start or
  // back to backlog on a turn end. So a persisted in_progress/done on a
  // main row is junk. Reset a main row to a neutral backlog so the
  // project's liveness comes ONLY from a real live engine handle.
  const kind: Task["kind"] = v.kind === "main" ? "main" : v.kind === "dir" ? "dir" : "task"
  // Scratch only means anything on a dir task — a corrupt flag elsewhere is
  // dropped rather than inventing a Scratch worktree row.
  const scratch = kind === "dir" && v.scratch === true
  const healedStatus: TaskStatus =
    kind === "main" && (v.status === "in_progress" || v.status === "done") ? "backlog" : v.status
  const deletion = coerceDeletion(v.deletion)
  const quotaResume = coerceQuotaResume(v.quotaResume)
  const linkedWorkItem = coerceLinkedWorkItem(v.linkedWorkItem)
  const dispatcher = coerceDispatcher(v.dispatcher)
  const routine = coerceRoutine(v.routine)

  const report = coerceWorkerReport(v.report)
  return {
    id: toTaskId(v.id),
    title: v.title,
    repo: v.repo,
    branch: v.branch,
    worktreePath: v.worktreePath,
    status: healedStatus,
    pinned: typeof v.pinned === "boolean" ? v.pinned : false,
    kind,
    ...(scratch ? { scratch: true } : {}),
    ...(routine ? { routine } : {}),
    vendor: coerceVendorId(typeof v.vendor === "string" ? v.vendor : undefined),
    // Raw launch command (`add --command` / `set-command`) — must survive
    // the load coercion or the task falls back to its protocol's preset on
    // every daemon restart, silently dropping the user's own command line.
    ...(typeof v.command === "string" && v.command.trim().length > 0 ? { command: v.command } : {}),
    prStatus: coercePRStatus(v.prStatus),
    // Engine reasoning/effort level — must survive the load coercion or the
    // task forgets its effort on every daemon restart.
    ...(typeof v.modelEffort === "string" && v.modelEffort.length > 0 ? { modelEffort: v.modelEffort } : {}),
    // Fan-out round marker — must survive the load coercion or siblings
    // lose their grouping on every daemon restart.
    ...(typeof v.groupId === "string" && v.groupId.length > 0 ? { groupId: v.groupId } : {}),
    // Observed user language — must survive the load coercion or a daemon
    // restart silently reverts injected prompts to English for a user who
    // never writes it. Same failure mode as the fields above: absent from
    // this list, the field writes fine and vanishes on load.
    ...(v.observedLanguage === "zh" || v.observedLanguage === "en" ? { observedLanguage: v.observedLanguage } : {}),
    ...(deletion ? { deletion } : {}),
    // The optional records below were written to disk but silently dropped
    // on load, so each survived only until the next daemon restart: a
    // pending quota resume was forgotten by the very runner whose
    // durability rationale is "absolute timestamp on disk", and a task
    // lost the tracker item it was started from.
    ...(quotaResume ? { quotaResume } : {}),
    ...(linkedWorkItem ? { linkedWorkItem } : {}),
    // Reply address for the collaboration loop — must survive the
    // load coercion or a daemon restart severs every sub-task's route home.
    // Records that predate the field normalize to undefined.
    ...(dispatcher ? { dispatcher } : {}),
    // The task brief (`add --prompt`) — must survive the load coercion or a
    // daemon restart destroys the only durable copy of what the task was
    // asked to do (the engine transcript does not survive the engine).
    ...(typeof v.prompt === "string" && v.prompt.length > 0 ? { prompt: v.prompt } : {}),
    // Recorded fork point (`add --base-branch`) — must survive the load
    // coercion or a daemon restart loses it before the lazy worktree
    // materialises (branches then silently cut from the guessed base), and
    // `collect`'s ahead/diffstat signals revert to the wrong comparison ref.
    ...(typeof v.baseRef === "string" && v.baseRef.trim().length > 0 ? { baseRef: v.baseRef } : {}),
    // Caller-chosen worktree directory (`add --worktree-name`). Same reason
    // `baseRef` survives the coercion: allocation is lazy, so a restart
    // between create and first enter would otherwise hand the task a random
    // animal name after the caller was told which path to expect.
    ...(typeof v.worktreeName === "string" && v.worktreeName.trim().length > 0 ? { worktreeName: v.worktreeName } : {}),
    // The worker's own outcome claim (`set-status --report-*`) — durable so a
    // dispatcher reading `collect` days later still sees what was reported.
    ...(report ? { report } : {}),
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
  }
}

/**
 * A worker's `set-status --report-*` claim. Every field is optional, so the
 * only thing that makes a report a report is its timestamp — an object
 * without one is a malformed row, not a report with a missing field.
 */
function coerceWorkerReport(value: unknown): TaskWorkerReport | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const v = value as Record<string, unknown>
  if (typeof v.at !== "string" || v.at.length === 0) return undefined
  return {
    at: v.at,
    ...(typeof v.branch === "string" && v.branch.length > 0 ? { branch: v.branch } : {}),
    ...(typeof v.pr === "number" && Number.isFinite(v.pr) ? { pr: v.pr } : {}),
    ...(typeof v.summary === "string" && v.summary.length > 0 ? { summary: v.summary } : {}),
  }
}

function coerceDispatcher(value: unknown): TaskDispatcher | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const v = value as Record<string, unknown>
  if (typeof v.taskId !== "string" || v.taskId.length === 0) return undefined
  if (typeof v.tabId !== "string" || v.tabId.length === 0) return undefined
  return { taskId: v.taskId, tabId: v.tabId }
}

/** Routine back-pointer. A link with no automation id is junk —
 *  dropped, so the task reads as an ordinary one rather than folding itself
 *  behind a routine section that can never be resolved back to a schedule. */
function coerceRoutine(value: unknown): TaskRoutineLink | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const v = value as Record<string, unknown>
  if (typeof v.automationId !== "string" || v.automationId.length === 0) return undefined
  return { automationId: v.automationId }
}

function coerceQuotaResume(value: unknown): TaskQuotaResumeState | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const v = value as Record<string, unknown>
  if (typeof v.resumeAt !== "string" || v.resumeAt.length === 0) return undefined
  if (typeof v.requestedAt !== "string" || v.requestedAt.length === 0) return undefined
  return { resumeAt: v.resumeAt, requestedAt: v.requestedAt }
}

function coerceLinkedWorkItem(value: unknown): TaskLinkedWorkItem | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const v = value as Record<string, unknown>
  if (v.provider !== "github") return undefined
  if (v.type !== "issue" && v.type !== "pr") return undefined
  if (typeof v.number !== "number" || !Number.isFinite(v.number)) return undefined
  if (typeof v.title !== "string" || typeof v.url !== "string" || v.url.length === 0) return undefined
  return { provider: v.provider, type: v.type, number: v.number, title: v.title, url: v.url }
}

function coerceDeletion(value: unknown): TaskDeletionState | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const v = value as Record<string, unknown>
  if (
    (v.phase !== "queued" && v.phase !== "running" && v.phase !== "error") ||
    typeof v.force !== "boolean" ||
    typeof v.requestedAt !== "string" ||
    v.requestedAt.length === 0 ||
    (v.error !== undefined && typeof v.error !== "string")
  ) {
    return undefined
  }
  return {
    phase: v.phase,
    force: v.force,
    // Delete-branch opt-in — must survive the load coercion or a daemon
    // restart silently downgrades the user's "delete branch too" to keep.
    ...(typeof v.deleteBranch === "boolean" ? { deleteBranch: v.deleteBranch } : {}),
    requestedAt: v.requestedAt,
    ...(typeof v.error === "string" ? { error: v.error } : {}),
  }
}

function coercePRStatus(value: unknown): TaskPRStatus | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const v = value as Record<string, unknown>
  if (!isPRProviderId(v.provider) || !isPRLifecycleState(v.lifecycle) || !isPRCheckState(v.checkState)) {
    return undefined
  }
  return {
    provider: v.provider,
    lifecycle: v.lifecycle,
    checkState: v.checkState,
    ...(typeof v.number === "number" && Number.isFinite(v.number) ? { number: v.number } : {}),
    ...(typeof v.url === "string" ? { url: v.url } : {}),
    ...(typeof v.title === "string" ? { title: v.title } : {}),
    ...(typeof v.baseRef === "string" ? { baseRef: v.baseRef } : {}),
    ...(typeof v.reviewDecision === "string" ? { reviewDecision: v.reviewDecision } : {}),
    ...(typeof v.mergeable === "string" ? { mergeable: v.mergeable } : {}),
    ...(typeof v.lastCheckedAt === "string" ? { lastCheckedAt: v.lastCheckedAt } : {}),
    ...(typeof v.lastError === "string" ? { lastError: v.lastError } : {}),
  }
}

function isPRProviderId(v: unknown): v is TaskPRStatus["provider"] {
  return v === "github" || v === "gitlab" || v === "bitbucket" || v === "unknown"
}

function isPRLifecycleState(v: unknown): v is TaskPRStatus["lifecycle"] {
  return (
    v === "creating" || v === "open" || v === "ready_to_merge" || v === "merged" || v === "closed" || v === "unknown"
  )
}

function isPRCheckState(v: unknown): v is TaskPRStatus["checkState"] {
  return v === "none" || v === "pending" || v === "passing" || v === "failing" || v === "unknown"
}

function isTaskStatus(s: string): s is TaskStatus {
  return (
    s === "backlog" || s === "in_progress" || s === "in_review" || s === "done" || s === "canceled" || s === "error"
  )
}
