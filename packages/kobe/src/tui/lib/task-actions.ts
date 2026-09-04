/**
 * Shared task-action flows — the ONE implementation behind every host
 * that exposes task mutations.
 * Host differences are an explicit option or hook on {@link TaskActionContext},
 * never a second copy.
 *
 * Testability rule: NO `@opentui` imports here. Modal UI (DialogConfirm /
 * RenameTaskDialog / NewTaskDialog) reaches this module only as
 * context-provided adapter callbacks (`confirm`, `promptText`,
 * `promptNewTask`), so the flows run under plain vitest with mocks
 * (`test/tui/task-actions.test.ts`).
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

/**
 * Confirm-modal copy for {@link TaskActionContext.confirm}. The COPY lives
 * in the flows (single source for both hosts); only the rendering is
 * host-provided — each host implements `confirm` with `DialogConfirm.show`.
 */
export interface ConfirmPrompt {
  readonly title: string
  readonly body: string
  readonly cancelLabel: string
  readonly confirmLabel: string
  /**
   * Destructive action (delete / force delete): the confirm dialog starts
   * focused on Cancel and draws the confirm button in the error color, so a
   * stray Enter cannot commit it. Flows own this — the host adapter only
   * forwards it to `DialogConfirm.show`.
   */
  readonly danger?: boolean
}

/** Optional labels for {@link TaskActionContext.promptText} (RenameTaskDialog reuses). */
export interface TextPromptOpts {
  readonly dialogTitle?: string
  readonly fieldLabel?: string
}

/**
 * Host-agnostic context bag the lifted flows run against. Required members
 * are what BOTH hosts provide; every optional member is a documented
 * host divergence — modeled here as an option/hook so neither host keeps
 * its own copy of a flow.
 */
export interface TaskActionContext {
  /**
   * Daemon-backed mutation surface. `null` only in the Tasks pane's
   * degraded no-daemon fallback, where mutations are unavailable — flows
   * no-op (or log, matching the pane's old behavior).
   */
  readonly orch: KobeOrchestrator | null
  /** Live task list accessor (orchestrator signal or file-poll fallback). */
  readonly tasks: () => readonly Task[]
  /** Confirm-modal adapter — host implements with `DialogConfirm.show(dialog, …) === true`. */
  readonly confirm: (prompt: ConfirmPrompt) => Promise<boolean>
  /** Text-input adapter — host implements with `RenameTaskDialog.show(dialog, …)`. */
  readonly promptText: (initial: string, opts?: TextPromptOpts) => Promise<string | undefined>
  /**
   * DIVERGENCE — the six-value {@link TaskStatus} picker behind
   * {@link setStatusFlow}. Optional because only the workspace host has a
   * surface that offers it (the tree's right-click menu); a host that omits
   * it makes the flow a no-op rather than forcing every host to carry a
   * dialog it never opens. Resolves `undefined` on cancel, like `promptText`.
   */
  readonly pickStatus?: (current: TaskStatus) => Promise<TaskStatus | undefined>
  /**
   * DIVERGENCE — system-clipboard writer behind {@link copyTaskFieldFlow}.
   * Optional for the same reason as `pickStatus`: only the workspace host has
   * a renderer to hand the OSC52 half to; a host that omits it makes the flow
   * a no-op.
   */
  readonly copyText?: (text: string) => void
  readonly logger: TaskActionLogger
  /** Forensic log tag — `[rove]` (outer monitor) vs `[rove tasks]` (Tasks pane). */
  readonly logPrefix: string
  /**
   * DIVERGENCE — on-screen failure toast. The Tasks pane surfaces failures
   * as red toasts (a bare console.error is invisible in the TUI); the outer monitor has no toast wiring for task actions, so
   * it omits this and failures stay log-only, as before.
   */
  readonly notifyError?: (message: string) => void
  /** DIVERGENCE — neutral "this happened" toast. Same split as `notifyError`. */
  readonly notifyInfo?: (message: string) => void
  /**
   * DIVERGENCE — force an immediate tasks.json re-read after a mutation.
   * The Tasks pane needs it for its poll fallback; the outer monitor is
   * signal-driven and omits it.
   */
  readonly reload?: () => Promise<void>
  /**
   * DIVERGENCE — publish the shared active-task focus after delete.
   * The Tasks pane sets this; the outer monitor historically didn't and
   * keeps that behavior.
   */
  readonly updateActiveTask?: boolean
  /**
   * DIVERGENCE — selection is host-owned signal state, so the post-delete
   * cursor move stays a hook: the Tasks pane prefers the flow-computed
   * `nextTask`, the outer monitor recomputes from the remaining list.
   */
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
 * True when `taskId` is the CURRENTLY active task, so delete should hand the
 * shared active-task focus to the next task. Deleting a BACKGROUND task must
 * not steal focus from whatever is active — an unconditional
 * `setActiveTask(nextTask)` would do exactly that. Both real orchestrators
 * expose `activeTaskSignal()`; when it's absent (a bare test mock) we fall back
 * to `true` rather than throw — real usage
 * always resolves the active id and gets the guard.
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
  // Only re-point shared active-task focus when the DELETED task was the active
  // one — deleting a background task must leave the current focus alone.
  if (opts.updateActiveTask && opts.orch && removedTaskIsActive(opts.orch, opts.taskId)) {
    await opts.orch.setActiveTask(nextTask?.id ?? null).catch(() => {})
  }
  await stopHostedTask(opts.taskId, opts.logger, opts.logPrefix)
  return { nextTask }
}

/**
 * Delete a task: confirm → non-force delete → on DIRTY_WORKTREE re-prompt
 * for an explicit force-delete → tear down hosted sessions → host
 * selection hook. The first attempt is deliberately non-force: the
 * orchestrator refuses to destroy a worktree with uncommitted/untracked
 * work and throws a DIRTY_WORKTREE error instead, so the user can't lose
 * unsaved work silently. A failed/declined delete leaves
 * everything in place — no session kill, no selection move.
 */
export async function deleteTaskFlow(ctx: TaskActionContext, taskId: string): Promise<void> {
  if (!ctx.orch) return
  const task = ctx.tasks().find((t) => t.id === taskId)
  if (!task) return
  // A "project" row is a synthetic `kind: "main"` task projecting a saved
  // repo. It has no worktree of its own to destroy, and `deleteTask` refuses
  // it (CannotDeleteMainTaskError), so `d` on it would just error.
  // Route it to forget-project instead: un-save the repo + drop the main row,
  // leaving the repo and any real tasks under it on disk.
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
    // A `dir` task pins the user's own directory — deletion only drops the
    // task entry; the directory is never touched.
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
        // Shared verbatim with the worktrees page's force-remove: one event,
        // one wording, and it names the salvage snapshot every force path
        // takes rather than promising the work is gone forever.
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
  // Only tear down the session + move selection if the task was actually
  // removed — a failed/declined delete must leave everything in place.
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
 * Rename a task's title via `task.rename` (same RPC from both hosts). The
 * branch follows the title for not-yet-materialised tasks (the auto branch
 * derives from it); a worktree that already exists keeps its git branch.
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
 * Rename a task's branch via `task.setBranch`. For a materialised worktree
 * the daemon runs `git branch -m` (HEAD moves on the checked-out worktree,
 * a running session keeps streaming); otherwise it just records the name
 * for the eventual `ensureWorktree`. No-op on `main` rows — the project
 * root's branch isn't kobe's to rename. Tasks-pane-only today (`b`), but
 * host-agnostic so the outer monitor could wire it without a port.
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
 * Cycle the task's engine vendor via `task.setVendor`.
 * Takes effect on the task's next enter: `ensureSession` rebuilds a session
 * whose `@kobe_vendor` tag does not match, launching the new engine.
 *
 * Cycle over the SAME detected-built-ins + custom set the new-task dialog
 * offers (`availableEngineIds()` + `nextVendorWithin`), not the built-ins
 * alone: a task on a user-added custom engine must be able to cycle back to
 * it instead of jumping to a built-in and getting stranded. Tasks-pane-only
 * today (`v`), lifted host-agnostic like {@link renameBranchFlow}.
 */
/**
 * Persist a task's engine and say so — the shared half of the two routes that
 * switch engines (`v` on a row, and the ctrl+e picker's "new tab in this
 * worktree"). Both need the same two toasts: without them a rejected
 * `setVendor` leaves a tab rendered under the NEW engine's label
 * while the task keeps the previous one — success and failure look identical.
 *
 * Returns whether the write landed, so a caller can undo its optimistic UI.
 */
export async function applyVendorChange(
  ctx: Pick<TaskActionContext, "orch" | "logger" | "logPrefix" | "notifyError" | "notifyInfo">,
  taskId: string,
  next: VendorId,
  /**
   * Skip the success toast. For the caller that ALREADY showed the result: the
   * ctrl+e picker opens a tab running the new engine right there, so the
   * "applies on reopen" line was both noise and untrue — the tab in front of
   * you is already the new engine. The failure toast is never optional; a
   * rejected write there leaves a tab labelled with an engine the task does
   * not have, which is exactly the divergence this function was added to
   * surface.
   */
  opts: {
    readonly silentSuccess?: boolean
    /** Reasoning level to persist alongside the engine. Absent = leave the
     *  task's alone (the engine declares none, or the caller has no opinion);
     *  `""` = clear it back to the engine's own default. */
    readonly effort?: string
  } = {},
): Promise<boolean> {
  if (!ctx.orch) return false
  try {
    await ctx.orch.setVendor(taskId, next, opts.effort)
  } catch (err) {
    ctx.logger.error(`${ctx.logPrefix} task.setVendor failed:`, err)
    ctx.notifyError?.(t("tasks.toast.switchEngineFailed", { error: errorMessage(err) }))
    return false
  }
  // Only for a change with nothing on screen to show it: the new vendor takes
  // effect on the task's NEXT enter (ensureSession rebuilds the pane when its
  // `@kobe_vendor` tag does not match), so `v` on a row otherwise looks
  // like a no-op.
  if (!opts.silentSuccess) ctx.notifyInfo?.(t("tasks.toast.engineSwitched", { engine: engineDisplayName(next) }))
  return true
}

export async function cycleVendorFlow(ctx: TaskActionContext, taskId: string): Promise<void> {
  const task = ctx.tasks().find((t) => t.id === taskId)
  if (!task || !ctx.orch) return
  const engines = await availableEngineIds()
  const next = nextVendorWithin(engines, task.vendor ?? DEFAULT_TASK_VENDOR)
  if (!(await applyVendorChange(ctx, taskId, next))) return
  await ctx.reload?.()
}

/**
 * Set a task's lifecycle status via `task.status` — a picker over the six
 * {@link TaskStatus} values, then one RPC.
 *
 * COSMETIC, and the copy has to keep saying so: the status is a LABEL on the
 * board (`docs/CONCEPTS.md`), so `canceled` does not close, stop, or clean up
 * anything — the worktree, the branch and every hosted session are exactly
 * where they were. That is the same framing the CLI verb carries
 * (`cli/api/verbs-edit.ts`), and the two must not drift: a "cancel" the user
 * reads as teardown is how someone loses a session they meant to keep.
 *
 * The success toast exists for the same reason `applyVendorChange`'s does —
 * a status the row renders as a chip only when it leaves backlog/in_progress
 * would otherwise look like a no-op on the two states that show nothing.
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
 * Copy a task's branch name or worktree path to the system clipboard (tree
 * menu "Copy branch name" / "Copy path"), for a `git checkout` / `cd` in
 * another shell.
 *
 * Reads the RECORDED `task.worktreePath` verbatim — it does NOT materialize the
 * worktree the way opening the task does (`openTaskWorktreeFor` calls
 * `ensureWorktree` first). A copy is a read; creating a directory as its side
 * effect would be the kind of surprise `rove api get-task` never springs. A
 * task never entered records "" for both fields, and the menu withholds the
 * entries then (tree-menu.ts); the empty-string guard here is the backstop.
 *
 * The success toast is the only feedback a clipboard write can have on screen,
 * so it echoes what was copied rather than a bare "copied".
 */
export function copyTaskFieldFlow(ctx: TaskActionContext, taskId: string, field: "branch" | "path"): void {
  const task = ctx.tasks().find((candidate) => candidate.id === taskId)
  if (!task || !ctx.copyText) return
  const text = field === "branch" ? task.branch : task.worktreePath
  if (text === "") return
  ctx.copyText(text)
  ctx.notifyInfo?.(t(field === "branch" ? "tasks.toast.copiedBranch" : "tasks.toast.copiedPath", { text }))
}
