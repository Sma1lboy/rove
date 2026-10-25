/**
 * Row codec: ONE persisted JSON entry → a v3 {@link Task}, or `null`. Never
 * sees the file; manifest-level concerns (lock retry, corrupt-version
 * recovery, read-merge-write) live in `store-codec.ts`, whose
 * `normalizeIndex` is the only caller.
 *
 * Every optional field must be listed below: a field absent from
 * {@link coerceTask} writes fine and vanishes on the next daemon restart.
 */

import { pathSyntax, samePath } from "@sma1lboy/rove-daemon/path-identity"
import { MULTI_REPO_CAP, REPO_NAME_RE } from "@sma1lboy/rove-daemon/task-tree"
import type {
  Task,
  TaskDeletionState,
  TaskDispatcher,
  TaskExtraRepo,
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

  // Nothing maintains a `main` task's status across turns, so a persisted
  // in_progress/done there is junk: reset to backlog so project liveness
  // comes ONLY from a real live engine handle.
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
  const lineage = coerceLineage(v, kind)
  const routine = coerceRoutine(v.routine)
  const extraRepos = coerceExtraRepos(v.extraRepos, v.repo)

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
    // Raw launch command; lost, the task falls back to its protocol's preset.
    ...(typeof v.command === "string" && v.command.trim().length > 0 ? { command: v.command } : {}),
    prStatus: coercePRStatus(v.prStatus),
    ...(typeof v.modelEffort === "string" && v.modelEffort.length > 0 ? { modelEffort: v.modelEffort } : {}),
    ...(typeof v.model === "string" && v.model.length > 0 ? { model: v.model } : {}),
    ...(typeof v.tier === "string" && v.tier.length > 0 ? { tier: v.tier } : {}),
    // Fan-out round marker: siblings' grouping.
    ...(typeof v.groupId === "string" && v.groupId.length > 0 ? { groupId: v.groupId } : {}),
    // Lost, injected prompts revert to English for a user who never writes it.
    ...(v.observedLanguage === "zh" || v.observedLanguage === "en" ? { observedLanguage: v.observedLanguage } : {}),
    ...(deletion ? { deletion } : {}),
    // A pending quota resume's durability rests on this timestamp being on disk.
    ...(quotaResume ? { quotaResume } : {}),
    ...(linkedWorkItem ? { linkedWorkItem } : {}),
    // Sub-task's route home in the collaboration loop; older records → undefined.
    ...(dispatcher ? { dispatcher } : {}),
    ...lineage,
    ...(v.deleteBranchPending === true ? { deleteBranchPending: true } : {}),
    // The only durable copy of the brief; the engine transcript dies with the engine.
    ...(typeof v.prompt === "string" && v.prompt.length > 0 ? { prompt: v.prompt } : {}),
    // Fork point: lost before the lazy worktree materialises, the branch is
    // cut from a guessed base and `collect` compares against the wrong ref.
    ...(typeof v.baseRef === "string" && v.baseRef.trim().length > 0 ? { baseRef: v.baseRef } : {}),
    // Caller-chosen worktree dir; allocation is lazy, so losing it would hand
    // out a random name after the caller was told the path.
    ...(typeof v.worktreeName === "string" && v.worktreeName.trim().length > 0 ? { worktreeName: v.worktreeName } : {}),
    // A secondary repo's worktree is only findable through this list: lost, it is an orphan nobody deletes.
    ...(extraRepos ? { extraRepos } : {}),
    // Worker's outcome claim, read by `collect` long after the fact.
    ...(report ? { report } : {}),
    // Every send to this task owes a `rove api report`; lost, a loop quietly stops being held to it.
    ...(v.requireReport === true ? { requireReport: true } : {}),
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
  }
}

/**
 * Secondary repos of a multi-repo task. A bad entry (unnamed, relative path,
 * duplicate name or root, the primary again, past the cap) is dropped, never
 * the row; none left → undefined.
 */
function coerceExtraRepos(value: unknown, primary: string): TaskExtraRepo[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: TaskExtraRepo[] = []
  for (const entry of value) {
    if (out.length >= MULTI_REPO_CAP - 1) break
    if (!entry || typeof entry !== "object") continue
    const e = entry as Record<string, unknown>
    if (typeof e.name !== "string" || !REPO_NAME_RE.test(e.name)) continue
    if (typeof e.repo !== "string" || !pathSyntax(e.repo).isAbsolute(e.repo)) continue
    const repo = e.repo
    if (samePath(repo, primary) || out.some((o) => o.name === e.name || samePath(o.repo, repo))) continue
    out.push({
      name: e.name,
      repo,
      branch: typeof e.branch === "string" ? e.branch : "",
      worktreePath: typeof e.worktreePath === "string" ? e.worktreePath : "",
      ...(typeof e.baseRef === "string" && e.baseRef.trim().length > 0 ? { baseRef: e.baseRef } : {}),
      ...(coercePRStatus(e.prStatus) ? { prStatus: coercePRStatus(e.prStatus) } : {}),
    })
  }
  return out.length > 0 ? out : undefined
}

/** A `update --report-*` claim; only its timestamp is required, so none → malformed. */
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

/** A task id pointing at the row itself is lineage corruption (a self-parent hides the row from every tree walk). */
function coerceTaskRef(value: unknown, selfId: string): string | undefined {
  return typeof value === "string" && value.length > 0 && value !== selfId ? value : undefined
}

/** Engine cwd below the worktree root: relative, no `..` segment, never escaping. */
function coerceCwdSubpath(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined
  if (/^[/\\]|^[a-z]:/i.test(value)) return undefined
  return value.split(/[/\\]/).includes("..") ? undefined : value
}

/**
 * Tree lineage fields. `sharesWorkspaceOf` only means anything on a `dir`/`task`
 * row (a sharer is never `main`), so it is dropped elsewhere rather than
 * leaving a main row that the project coordinator would skip.
 */
function coerceLineage(v: Record<string, unknown>, kind: Task["kind"]): Partial<Task> {
  const selfId = v.id as string
  const parentTaskId = coerceTaskRef(v.parentTaskId, selfId)
  const sharesWorkspaceOf = kind === "main" ? undefined : coerceTaskRef(v.sharesWorkspaceOf, selfId)
  const cwdSubpath = coerceCwdSubpath(v.cwdSubpath)
  // Same {taskId, tabId} session-pointer shape as the dispatcher.
  const ptyAlias = coerceDispatcher(v.ptyAlias)
  return {
    ...(parentTaskId ? { parentTaskId: toTaskId(parentTaskId) } : {}),
    ...(sharesWorkspaceOf ? { sharesWorkspaceOf: toTaskId(sharesWorkspaceOf) } : {}),
    ...(cwdSubpath ? { cwdSubpath } : {}),
    ...(ptyAlias ? { ptyAlias } : {}),
  }
}

/** Routine back-pointer. No automation id → dropped, so the task reads as
 *  ordinary instead of folding behind an unresolvable routine section. */
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
    // Lost, a restart downgrades "delete branch too" to keep.
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
