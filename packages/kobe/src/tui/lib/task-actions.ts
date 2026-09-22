/**
 * The one implementation of task-mutation flows for every host; host
 * differences are options/hooks on {@link TaskActionContext}, never a copy.
 * No `@opentui` imports: modal UI arrives as `confirm`/`promptText`/… adapter
 * callbacks so the flows run under plain vitest (`test/tui/task-actions.test.ts`).
 */

import type { KobeOrchestrator } from "@/client/remote-orchestrator"
import { availableEngineIds } from "@/engine/account-detect"
import { hostedTaskKeys, killHostedSessions, listHostedSessions, openHostedSessionHost } from "@/engine/hosted-session"
import { engineDisplayName } from "@/engine/interactive-command"
import { errorMessage } from "@/lib/error-message"
import { DIRTY_WORKTREE_CODE } from "@/orchestrator/errors"
import { t } from "@/tui/i18n"
import { DEFAULT_TASK_VENDOR, type Task, type TaskStatus, type VendorId } from "@/types/task"
import { nextVendorWithin } from "@/types/vendor"

export interface TaskActionLogger {
  error(message?: unknown, ...optionalParams: unknown[]): void
}

/** Confirm copy lives in the flows; hosts only render it via `DialogConfirm.show`. */
export interface ConfirmPrompt {
  readonly title: string
  readonly body: string
  readonly cancelLabel: string
  readonly confirmLabel: string
  /** Dialog starts focused on Cancel with an error-colored confirm, so a stray Enter can't commit. */
  readonly danger?: boolean
}

/** Optional labels for {@link TaskActionContext.promptText} (RenameTaskDialog reuses). */
export interface TextPromptOpts {
  readonly dialogTitle?: string
  readonly fieldLabel?: string
}

/** What {@link TaskActionContext.pickEngine} is asked, and what it answers. */
interface EnginePickOpts {
  readonly engines: readonly VendorId[]
  readonly current: VendorId
  readonly currentEffort?: string
  readonly currentModel?: string
}
export interface EnginePick {
  readonly vendor: VendorId
  /** Absent = the engine declares none; `""` = clear it. Same for `model`. */
  readonly effort?: string
  readonly model?: string
}

/** Required members are what every host provides; each optional member is a documented host divergence. */
export interface TaskActionContext {
  /** `null` only in the Tasks pane's no-daemon fallback; flows then no-op or log. */
  readonly orch: KobeOrchestrator | null
  /** Orchestrator signal or file-poll fallback. */
  readonly tasks: () => readonly Task[]
  /** Host implements with `DialogConfirm.show(dialog, …) === true`. */
  readonly confirm: (prompt: ConfirmPrompt) => Promise<boolean>
  /** Host implements with `RenameTaskDialog.show(dialog, …)`. */
  readonly promptText: (initial: string, opts?: TextPromptOpts) => Promise<string | undefined>
  /**
   * Status picker behind {@link setStatusFlow}; only the workspace host offers
   * it (tree right-click menu). Absent → the flow no-ops. `undefined` = cancel.
   */
  readonly pickStatus?: (current: TaskStatus) => Promise<TaskStatus | undefined>
  /** Engine picker behind {@link pickVendorFlow}; absent → no-op. Host uses `EnginePickerDialog.show`. */
  readonly pickEngine?: (opts: EnginePickOpts) => Promise<EnginePick | undefined>
  /** Clipboard writer behind {@link copyTaskFieldFlow}; only the workspace host has a renderer for OSC52. Absent → no-op. */
  readonly copyText?: (text: string) => Promise<boolean>
  readonly logger: TaskActionLogger
  /** `[rove]` (outer monitor) vs `[rove tasks]` (Tasks pane). */
  readonly logPrefix: string
  /** Failure toast (a bare console.error is invisible in the TUI). The outer monitor omits it: log-only. */
  readonly notifyError?: (message: string) => void
  /** Neutral info toast; same split as `notifyError`. */
  readonly notifyInfo?: (message: string) => void
  /** Force a tasks.json re-read after a mutation; the Tasks pane's poll fallback needs it. */
  readonly reload?: () => Promise<void>
  /** Publish shared active-task focus after delete. Tasks pane only; the outer monitor keeps not doing it. */
  readonly updateActiveTask?: boolean
  /** Post-delete cursor move; selection is host-owned. The Tasks pane uses `nextTask`, the monitor recomputes. */
  readonly onTaskDeleted?: (taskId: string, nextTask: Task | undefined) => void
}

export function nextActiveTask(tasks: readonly Task[], excludeId: string): Task | undefined {
  return tasks.find((t) => t.id !== excludeId)
}

async function stopHostedTask(taskId: string, logger: TaskActionLogger, logPrefix: string): Promise<void> {
  const host = await openHostedSessionHost()
  if (!host) return
  try {
    await killHostedSessions(host.rpc, hostedTaskKeys(await listHostedSessions(host.rpc), taskId))
  } catch (err) {
    logger.error(`${logPrefix} kill hosted session failed:`, err)
  } finally {
    host.close()
  }
}

/**
 * Deleting a BACKGROUND task must not steal focus from the active one. A bare
 * test mock without `activeTaskSignal()` counts as active.
 */
function removedTaskIsActive(orch: KobeOrchestrator, taskId: string): boolean {
  const read = (orch as { activeTaskSignal?: () => () => string | null }).activeTaskSignal
  if (typeof read !== "function") return true
  return read.call(orch)() === taskId
}

export async function finishDeletedTaskFlow(opts: {
  readonly orch?: KobeOrchestrator
  readonly tasks: readonly Task[]
  readonly taskId: string
  readonly logger: TaskActionLogger
  readonly logPrefix: string
  readonly updateActiveTask?: boolean
}): Promise<{ nextTask?: Task }> {
  const nextTask = nextActiveTask(opts.tasks, opts.taskId)
  if (opts.updateActiveTask && opts.orch && removedTaskIsActive(opts.orch, opts.taskId)) {
    await opts.orch.setActiveTask(nextTask?.id ?? null).catch(() => {})
  }
  await stopHostedTask(opts.taskId, opts.logger, opts.logPrefix)
  return { nextTask }
}

/**
 * The first attempt is non-force: the orchestrator refuses a worktree with
 * uncommitted/untracked work (DIRTY_WORKTREE), and only then do we ask for an
 * explicit force. A failed/declined delete leaves everything in place.
 */
export async function deleteTaskFlow(ctx: TaskActionContext, taskId: string): Promise<void> {
  if (!ctx.orch) return
  const task = ctx.tasks().find((t) => t.id === taskId)
  if (!task) return
  // A `kind: "main"` project row has no worktree and `deleteTask` refuses it
  // (CannotDeleteMainTaskError). Forget the project instead: the repo and any
  // real tasks under it stay on disk.
  if (task.kind === "main") {
    const ok = await ctx.confirm({
      title: t("tasks.confirm.forgetProjectTitle", { title: task.title }),
      body: t("tasks.confirm.forgetProjectBody"),
      cancelLabel: t("tasks.confirm.cancel"),
      confirmLabel: t("tasks.confirm.forgetProjectConfirm"),
    })
    if (!ok) return
    try {
      await ctx.orch.forgetProject(task.repo)
    } catch (err) {
      ctx.logger.error(`${ctx.logPrefix} forget project failed:`, err)
      ctx.notifyError?.(t("tasks.toast.forgetProjectFailed", { error: errorMessage(err) }))
      return
    }
    await ctx.reload?.()
    return
  }
  const ok = await ctx.confirm({
    title: t("tasks.confirm.deleteTitle", { title: task.title }),
    // A `dir` task pins the user's own directory; only the entry is dropped.
    body: t(task.kind === "dir" ? "tasks.confirm.deleteBodyDir" : "tasks.confirm.deleteBodyTask"),
    cancelLabel: t("tasks.confirm.cancel"),
    confirmLabel: t("tasks.confirm.deleteConfirm"),
    danger: true,
  })
  if (!ok) return
  let deleted = false
  try {
    await ctx.orch.deleteTask(taskId)
    deleted = true
  } catch (err) {
    const message = errorMessage(err)
    if (message.includes(DIRTY_WORKTREE_CODE)) {
      const forceOk = await ctx.confirm({
        title: t("tasks.confirm.forceDeleteTitle", { title: task.title }),
        // Shared with the worktrees page's force-remove; it names the salvage
        // snapshot every force path takes.
        body: t("worktrees.delete.forceBody", { branch: task.branch || task.title }),
        cancelLabel: t("tasks.confirm.cancel"),
        confirmLabel: t("tasks.confirm.forceDeleteConfirm"),
        danger: true,
      })
      if (forceOk) {
        try {
          await ctx.orch.deleteTask(taskId, { force: true })
          deleted = true
        } catch (forceErr) {
          ctx.logger.error(`${ctx.logPrefix} force delete failed:`, forceErr)
          ctx.notifyError?.(t("tasks.toast.deleteFailed", { title: task.title, error: errorMessage(forceErr) }))
        }
      }
    } else {
      ctx.logger.error(`${ctx.logPrefix} delete failed:`, err)
      ctx.notifyError?.(t("tasks.toast.deleteFailed", { title: task.title, error: errorMessage(err) }))
    }
  }
  if (!deleted) return
  const { nextTask } = await finishDeletedTaskFlow({
    orch: ctx.orch,
    tasks: ctx.tasks(),
    taskId,
    logger: ctx.logger,
    logPrefix: ctx.logPrefix,
    updateActiveTask: ctx.updateActiveTask,
  })
  await ctx.reload?.()
  ctx.onTaskDeleted?.(taskId, nextTask)
}

/**
 * The branch follows the title only for not-yet-materialised tasks; an
 * existing worktree keeps its git branch.
 */
export async function renameTaskFlow(ctx: TaskActionContext, taskId: string): Promise<void> {
  const task = ctx.tasks().find((t) => t.id === taskId)
  if (!task) return
  const next = await ctx.promptText(task.title)
  if (!next || !ctx.orch) return
  try {
    await ctx.orch.setTitle(taskId, next)
  } catch (err) {
    ctx.logger.error(`${ctx.logPrefix} task.rename failed:`, err)
    ctx.notifyError?.(t("tasks.toast.renameFailed", { error: errorMessage(err) }))
    return
  }
  await ctx.reload?.()
}

/**
 * Materialised worktree: the daemon runs `git branch -m` (a running session
 * keeps streaming); otherwise the name is recorded for `ensureWorktree`. No-op
 * on `main` rows: the project root's branch isn't Rove's to rename.
 */
export async function renameBranchFlow(ctx: TaskActionContext, taskId: string): Promise<void> {
  const task = ctx.tasks().find((t) => t.id === taskId)
  if (!task || task.kind === "main") return
  const next = await ctx.promptText(task.branch, {
    dialogTitle: t("tasks.renameBranch.title"),
    fieldLabel: t("tasks.renameBranch.fieldLabel"),
  })
  if (!next || !ctx.orch) return
  try {
    await ctx.orch.setBranch(taskId, next)
  } catch (err) {
    ctx.logger.error(`${ctx.logPrefix} task.setBranch failed:`, err)
    ctx.notifyError?.(t("tasks.toast.renameBranchFailed", { branch: task.branch, error: errorMessage(err) }))
    return
  }
  await ctx.reload?.()
}

/**
 * Persist a task's engine and toast either way; without the toasts a rejected
 * `setVendor` leaves a tab labelled with the new engine while the task keeps
 * the old one. Returns whether the write landed, for optimistic-UI undo.
 */
export async function applyVendorChange(
  ctx: Pick<TaskActionContext, "orch" | "logger" | "logPrefix" | "notifyError" | "notifyInfo">,
  taskId: string,
  next: VendorId,
  /**
   * `silentSuccess`: for a caller that already opened a tab on the new engine,
   * where "applies on reopen" would be untrue. The failure toast is never optional.
   */
  opts: {
    readonly silentSuccess?: boolean
    /** Absent = leave the task's alone; `""` = clear back to the engine default. */
    readonly effort?: string
    /** Same tri-state for the pinned model. */
    readonly model?: string
  } = {},
): Promise<boolean> {
  if (!ctx.orch) return false
  try {
    await ctx.orch.setVendor(taskId, next, opts.effort, opts.model)
  } catch (err) {
    ctx.logger.error(`${ctx.logPrefix} task.setVendor failed:`, err)
    ctx.notifyError?.(t("tasks.toast.switchEngineFailed", { error: errorMessage(err) }))
    return false
  }
  // The new vendor applies on the NEXT enter (ensureSession rebuilds a pane
  // whose `@kobe_vendor` tag mismatches), so without this `v` looks like a no-op.
  if (!opts.silentSuccess) ctx.notifyInfo?.(t("tasks.toast.engineSwitched", { engine: engineDisplayName(next) }))
  return true
}

/**
 * Re-picking the same engine at a different level or model is a real change,
 * so `pick.vendor === current` alone would swallow it.
 */
export async function pickVendorFlow(ctx: TaskActionContext, taskId: string): Promise<void> {
  const task = ctx.tasks().find((t) => t.id === taskId)
  if (!task || !ctx.pickEngine) return
  const current = task.vendor ?? DEFAULT_TASK_VENDOR
  const engines = await availableEngineIds()
  const pick = await ctx.pickEngine({
    engines: engines.length > 0 ? engines : [current],
    current,
    currentEffort: task.modelEffort,
    currentModel: task.model,
  })
  if (!pick) return
  const sameEffort = pick.effort === undefined || pick.effort === (task.modelEffort ?? "")
  const sameModel = pick.model === undefined || pick.model === (task.model ?? "")
  if (pick.vendor === current && sameEffort && sameModel) return
  await applyVendorChange(ctx, taskId, pick.vendor, { effort: pick.effort, model: pick.model })
}

/**
 * Cycles over the same set the new-task dialog offers (detected built-ins +
 * custom engines), so a custom-engine task can cycle back to its engine.
 */
export async function cycleVendorFlow(ctx: TaskActionContext, taskId: string): Promise<void> {
  const task = ctx.tasks().find((t) => t.id === taskId)
  if (!task || !ctx.orch) return
  const engines = await availableEngineIds()
  const next = nextVendorWithin(engines, task.vendor ?? DEFAULT_TASK_VENDOR)
  if (!(await applyVendorChange(ctx, taskId, next))) return
  await ctx.reload?.()
}

/**
 * COSMETIC: status is a board LABEL (`docs/CONCEPTS.md`); `canceled` closes,
 * stops and cleans up nothing. Keep the copy saying so, in step with the CLI
 * verb (`cli/api/verbs-edit.ts`): a "cancel" read as teardown loses sessions.
 * The success toast exists because backlog/in_progress render no chip.
 */
export async function setStatusFlow(ctx: TaskActionContext, taskId: string): Promise<void> {
  const task = ctx.tasks().find((t) => t.id === taskId)
  if (!task || !ctx.orch || !ctx.pickStatus) return
  const next = await ctx.pickStatus(task.status)
  if (!next || next === task.status) return
  try {
    await ctx.orch.setStatus(taskId, next)
  } catch (err) {
    ctx.logger.error(`${ctx.logPrefix} task.status failed:`, err)
    ctx.notifyError?.(t("tasks.toast.setStatusFailed", { status: task.status, error: errorMessage(err) }))
    return
  }
  ctx.notifyInfo?.(t("tasks.toast.statusSet", { status: next }))
  await ctx.reload?.()
}

/**
 * Copies the RECORDED `task.worktreePath`/branch; never materializes the
 * worktree (a read must not create a directory). A never-entered task records
 * "" for both; tree-menu.ts hides the entries and the `""` guard is the backstop.
 * The toast echoes the text and prints only once `copyText` confirms: a
 * headless box may have no clipboard command and some terminals refuse OSC 52.
 */
export async function copyTaskFieldFlow(
  ctx: TaskActionContext,
  taskId: string,
  field: "branch" | "path",
): Promise<void> {
  const task = ctx.tasks().find((candidate) => candidate.id === taskId)
  if (!task || !ctx.copyText) return
  const text = field === "branch" ? task.branch : task.worktreePath
  if (text === "") return
  if (!(await ctx.copyText(text))) {
    ctx.notifyError?.(t("tasks.toast.copyFailed"))
    return
  }
  ctx.notifyInfo?.(t(field === "branch" ? "tasks.toast.copiedBranch" : "tasks.toast.copiedPath", { text }))
}
