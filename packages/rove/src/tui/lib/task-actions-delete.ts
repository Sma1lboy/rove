/**
 * The delete half of the shared task flows (`task-actions.ts` re-exports it): deleting a task, ending a
 * project main's conversation, removing a project from the list, and tearing down what a delete removed.
 */

import type { RoveOrchestrator } from "@/client/remote-orchestrator"
import type { TaskDeleteReply } from "@/client/remote-orchestrator-writes"
import { hostedTaskKeys, killHostedSessions, listHostedSessions, openHostedSessionHost } from "@/engine/hosted-session"
import { errorMessage } from "@/lib/error-message"
import { dirtyRefusalReason } from "@/orchestrator/errors"
import { childrenOf } from "@/orchestrator/task-tree"
import { t } from "@/tui/i18n"
import { repoBasename } from "@/tui/panes/sidebar/groups"
import type { Task } from "@/types/task"
import { type TeardownScope, teardownScope } from "@sma1lboy/rove-daemon/daemon/pty-alias"
import type { TaskActionContext, TaskActionLogger } from "./task-actions"

export function nextActiveTask(tasks: readonly Task[], excludeId: string): Task | undefined {
  return tasks.find((t) => t.id !== excludeId)
}

async function stopHostedTask(
  taskId: string,
  tasks: readonly Task[],
  logger: TaskActionLogger,
  logPrefix: string,
  daemonScope?: TeardownScope,
): Promise<void> {
  const host = await openHostedSessionHost()
  if (!host) return
  try {
    // A surviving child's conversation may live in this task's PTY key space; the task's own aliased one dies with it.
    const scope = daemonScope ?? teardownScope(tasks, taskId, new Set([taskId]))
    await killHostedSessions(host.rpc, hostedTaskKeys(await listHostedSessions(host.rpc), taskId, scope))
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
function removedTaskIsActive(orch: RoveOrchestrator, taskId: string): boolean {
  const read = (orch as { activeTaskSignal?: () => () => string | null }).activeTaskSignal
  if (typeof read !== "function") return true
  return read.call(orch)() === taskId
}

const NO_SCOPE_CHANGE: TeardownScope = { spare: [], also: [] }

export async function finishDeletedTaskFlow(opts: {
  readonly orch?: RoveOrchestrator
  readonly tasks: readonly Task[]
  readonly taskId: string
  readonly logger: TaskActionLogger
  readonly logPrefix: string
  readonly updateActiveTask?: boolean
  /** The daemon's scope for this task; absent → worked out from `tasks` as if only this task left. */
  readonly scope?: TeardownScope
}): Promise<{ nextTask?: Task }> {
  const nextTask = nextActiveTask(opts.tasks, opts.taskId)
  if (opts.updateActiveTask && opts.orch && removedTaskIsActive(opts.orch, opts.taskId)) {
    await opts.orch.setActiveTask(nextTask?.id ?? null).catch(() => {})
  }
  await stopHostedTask(opts.taskId, opts.tasks, opts.logger, opts.logPrefix, opts.scope)
  return { nextTask }
}

/** Project header → Remove project: only the list entry goes; the repo, its branches, worktrees and tasks stay on disk. */
export async function forgetProjectFlow(ctx: TaskActionContext, taskId: string): Promise<void> {
  if (!ctx.orch) return
  const task = ctx.tasks().find((t) => t.id === taskId)
  if (!task) return
  const ok = await ctx.confirm({
    title: t("tasks.confirm.forgetProjectTitle", { title: repoBasename(task.repo) }),
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
}

/**
 * `deleteTask` refuses a project's main checkout, and deleting its row must not drop the project: it
 * ends the conversation (kills the sessions, forgets the tabs) and touches nothing on disk. With
 * children the dialog also offers to delete them, each through the ordinary delete round.
 */
async function endMainConversationFlow(ctx: TaskActionContext, main: Task): Promise<void> {
  const children = childrenOf(ctx.tasks(), main.id)
  let cascade = false
  if (children.length > 0 && ctx.pickChildren) {
    const choice = await ctx.pickChildren({
      title: t("tasks.confirm.childrenTitle", { title: main.title, count: String(children.length) }),
      body: t("tasks.confirm.childrenBodyMain"),
      promoteLabel: t("tasks.confirm.childrenKeepMain"),
      cascadeLabel: t("tasks.confirm.childrenCascadeMain"),
      cancelLabel: t("tasks.confirm.cancel"),
    })
    if (choice === undefined) return
    cascade = choice === "cascade"
  } else {
    const ok = await ctx.confirm({
      title: t("tasks.confirm.deleteTitleDir", { title: main.title }),
      body: t("tasks.confirm.deleteBodyMain"),
      cancelLabel: t("tasks.confirm.cancel"),
      confirmLabel: t("tasks.confirm.deleteConfirm"),
      danger: true,
    })
    if (!ok) return
  }
  if (cascade) {
    // A child left standing (declined force, failure) stops the round before the conversation ends.
    for (const child of children) if (!(await removeTask(ctx, child, { deleteBranch: false, cascade: true }))) return
  }
  // The host closes the task's tabs first (each ends its own session); the kill sweeps what no tab record names.
  ctx.onConversationEnded?.(main.id)
  await stopHostedTask(main.id, ctx.tasks(), ctx.logger, ctx.logPrefix)
  await ctx.reload?.()
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
  if (task.kind === "main") return endMainConversationFlow(ctx, task)
  // `-d` only: the forced retry below never deletes the branch, so an
  // unmerged branch can't vanish behind a dirty-worktree confirm.
  const deleteBranch = task.kind !== "dir" && ctx.deleteBranchOnDelete?.() === true
  const children = childrenOf(ctx.tasks(), taskId)
  let cascade = false
  if (children.length > 0 && ctx.pickChildren) {
    // One dialog: the plain confirm would hide that children are involved.
    const choice = await ctx.pickChildren({
      title: t("tasks.confirm.childrenTitle", { title: task.title, count: String(children.length) }),
      body: t("tasks.confirm.childrenBody"),
      promoteLabel: t("tasks.confirm.childrenPromote"),
      cascadeLabel: t("tasks.confirm.childrenCascade"),
      cancelLabel: t("tasks.confirm.cancel"),
    })
    if (choice === undefined) return
    cascade = choice === "cascade"
  } else {
    const ok = await ctx.confirm({
      title: t(task.kind === "dir" ? "tasks.confirm.deleteTitleDir" : "tasks.confirm.deleteTitle", {
        title: task.title,
      }),
      // A `dir` task pins the user's own directory; only the entry is dropped.
      body: t(
        task.kind === "dir"
          ? "tasks.confirm.deleteBodyDir"
          : deleteBranch
            ? "tasks.confirm.deleteBodyTaskBranch"
            : "tasks.confirm.deleteBodyTask",
      ),
      cancelLabel: t("tasks.confirm.cancel"),
      confirmLabel: t("tasks.confirm.deleteConfirm"),
      danger: true,
    })
    if (!ok) return
  }
  await removeTask(ctx, task, { deleteBranch, cascade })
}

/** One delete round: the plain attempt, a force confirm on DIRTY_WORKTREE, then the teardown of what the daemon removed. True when the task went. */
async function removeTask(
  ctx: TaskActionContext,
  task: Task,
  opts: { readonly deleteBranch: boolean; readonly cascade: boolean },
): Promise<boolean> {
  const { orch } = ctx
  if (!orch) return false
  const { deleteBranch, cascade } = opts
  const taskId = task.id
  // Promote is the daemon's default, so only a cascade needs saying.
  const cascadeOpt = cascade ? { cascade: true } : {}
  let reply: TaskDeleteReply | undefined
  let deleted = false
  try {
    // The in-process orchestrator answers with nothing; only the daemon client carries a reply.
    reply = (await (deleteBranch || cascade
      ? orch.deleteTask(taskId, { ...(deleteBranch ? { deleteBranch: true } : {}), ...cascadeOpt })
      : orch.deleteTask(taskId))) as TaskDeleteReply | undefined
    deleted = true
  } catch (err) {
    const reason = dirtyRefusalReason(err)
    if (reason !== null) {
      const forceOk = await ctx.confirm({
        title: t("tasks.confirm.forceDeleteTitle", { title: task.title }),
        // Shared with the worktrees page's force-remove; it names the salvage
        // snapshot every force path takes, and the refusal names the files.
        // The title above already names the task; its raw id is noise here.
        body: `${t("worktrees.delete.forceBody", { branch: task.branch || task.title })}\n\n${t("worktrees.delete.forceReason", { reason: reason.replace(`task ${taskId} `, "") })}`,
        cancelLabel: t("tasks.confirm.cancel"),
        confirmLabel: t("tasks.confirm.forceDeleteConfirm"),
        danger: true,
      })
      if (forceOk) {
        try {
          reply = (await orch.deleteTask(taskId, { force: true, ...cascadeOpt })) as TaskDeleteReply | undefined
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
  if (!deleted) return false
  // Tear down what the daemon says it removed: an older one ignores `cascade` and deletes only the
  // named task, and its children's PTYs must live on.
  const removed = reply?.deleted ?? [taskId]
  const gone = new Set(removed)
  const remaining = ctx.tasks().filter((candidate) => !gone.has(candidate.id))
  let nextTask: Task | undefined
  for (const id of removed) {
    const finished = await finishDeletedTaskFlow({
      orch,
      tasks: remaining,
      taskId: id,
      logger: ctx.logger,
      logPrefix: ctx.logPrefix,
      updateActiveTask: ctx.updateActiveTask,
      // A reply that lists the removed set also speaks for tasks it leaves out of `teardown`: nothing differs.
      scope: reply?.teardown?.[id] ?? (reply?.deleted ? NO_SCOPE_CHANGE : undefined),
    })
    if (id === taskId) nextTask = finished.nextTask
  }
  await ctx.reload?.()
  for (const id of removed) ctx.onTaskDeleted?.(id, nextTask)
  return true
}
