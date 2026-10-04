/**
 * Create/adopt flow behind the NewTaskDialog. NO `@opentui` imports: the dialog
 * arrives only as the `promptNewTask` callback, so this runs under plain vitest.
 */

import { availableEngineIds } from "@/engine/account-detect"
import { errorMessage } from "@/lib/error-message"
import { addSavedRepo, getSavedRepos } from "@/state/repos"
import { t } from "@/tui/i18n"
import { DEFAULT_TASK_VENDOR, type Task, type VendorId } from "@/types/task"
import type { NewTaskDialogOptions, NewTaskInput } from "../component/new-task-dialog/state"
import type { TaskActionContext } from "./task-actions"

/** Hosts build ONE of these and pass it to every flow. */
export interface CreateTaskContext extends TaskActionContext {
  /** New-task dialog adapter — host implements with `NewTaskDialog.show(dialog, …)`. */
  readonly promptNewTask: (
    defaultRepo: string,
    repos: readonly string[],
    opts: NewTaskDialogOptions,
  ) => Promise<NewTaskInput | undefined>
  /**
   * DIVERGENCE — default repo: the outer monitor uses the active task's; the
   * Tasks pane the cursor row's (else the first task's). Both then fall back
   * to `savedRepos[0]`, then `process.cwd()`.
   */
  readonly cursorRepo: () => string | undefined
  /** Repo-scoped vendor preference — see state/vendor-prefs.ts. */
  readonly lastVendor: (repo: string) => VendorId | undefined
  readonly rememberVendor: (repo: string, vendor: VendorId) => void
  /**
   * DIVERGENCE — after `addSavedRepo`, the outer monitor mirrors the fresh
   * list into its kv store so the debounced whole-store flush doesn't
   * clobber the disk write. The Tasks pane is disk-only and omits this.
   */
  readonly onRepoSaved?: () => void
  /** Land the host's cursor/selection on the created (or last adopted) task. */
  readonly selectTask?: (id: string) => void
  /**
   * Switch into the created (or last adopted) task so `n` lands in the engine
   * pane ready to type. Absent → cursor-only. The chattab surface jumps itself.
   */
  readonly enterTask?: (id: string) => void | Promise<void>
}

/** Repo roots with a `main` task, trailing slashes trimmed as the sidebar groups them. */
function mainRepoSet(tasks: readonly Task[]): ReadonlySet<string> {
  const out = new Set<string>()
  for (const task of tasks) {
    if (task.kind !== "main") continue
    const key = task.repo.trim().replace(/[\\/]+$/, "")
    if (key) out.add(key)
  }
  return out
}

/** Default repo → dialog → persist vendor + repo → create / adopt / open → select and enter. */
export async function createTaskFlow(ctx: CreateTaskContext): Promise<void> {
  const repos = getSavedRepos()
  // With no saved repos, cwd lets the user pick a path in-TUI instead of a shell `add`.
  const defaultRepo = ctx.cursorRepo() ?? repos[0] ?? process.cwd()
  const defaultVendor = ctx.lastVendor(defaultRepo) ?? DEFAULT_TASK_VENDOR
  const availableVendors = await availableEngineIds()
  // No engine at all: otherwise the missing binary surfaces only as a raw shell
  // error in the pane. Warn but proceed; they may install it after picking.
  if (availableVendors.length === 0) {
    ctx.notifyInfo?.("No engine CLI detected — install a supported engine, or add one in Settings → Engines")
  }
  const orch = ctx.orch
  const result = await ctx.promptNewTask(defaultRepo, repos, {
    defaultVendor,
    availableVendors,
    discoverAdoptable: orch ? (repo) => orch.discoverAdoptableWorktrees(repo) : undefined,
    // "Open the project" is offered only for these. From live tasks, not
    // savedRepos: a saved repo with no main row has no project to open.
    mainRepos: mainRepoSet(ctx.tasks()),
  })
  if (!result) return
  // Auto-save keeps `add` optional. Use the returned git toplevel so a
  // subdirectory entry is keyed under the same root the task record gets.
  const repo = addSavedRepo(result.repo).path
  ctx.rememberVendor(repo, result.vendor)
  ctx.onRepoSaved?.()
  if (!orch) {
    // The dialog is already closed; without a toast this reads as silent success.
    ctx.logger.error(`${ctx.logPrefix} no daemon; cannot create task`)
    ctx.notifyError?.(t("tasks.toast.noDaemonWorktree"))
    return
  }
  // "Open the project": the repo's OWN checkout. `ensureMainTask` is idempotent,
  // so it both revives a sidebar-hidden project and creates a missing row.
  // Ahead of the "Creating task…" toast: this is navigation, nothing is created.
  if (result.mode === "open") {
    try {
      const main = await orch.ensureMainTask(repo)
      await ctx.reload?.()
      ctx.selectTask?.(main.id)
      await ctx.enterTask?.(main.id)
    } catch (err) {
      ctx.logger.error(`${ctx.logPrefix} ensureMainTask failed:`, err)
      ctx.notifyError?.(t("newTask.open.failed", { error: errorMessage(err) }))
    }
    return
  }
  // The git-worktree op has no other feedback once the dialog vanishes.
  ctx.notifyInfo?.("Creating task…")
  let createdId: string | undefined
  if (result.mode === "adopt") {
    // Adopts are independent: report N/M so a later failure can't hide the
    // ones that DID persist behind a generic error. Focus the last success.
    const total = result.adopt.length
    let adopted = 0
    let firstError: string | undefined
    for (const w of result.adopt) {
      try {
        const task = await orch.adoptWorktree({
          repo,
          worktreePath: w.worktreePath,
          branch: w.branch,
          vendor: result.vendor,
        })
        createdId = task.id
        adopted++
      } catch (err) {
        if (firstError === undefined) firstError = errorMessage(err)
        ctx.logger.error(`${ctx.logPrefix} adoptWorktree failed for ${w.worktreePath}:`, err)
      }
    }
    if (adopted === 0) {
      ctx.notifyError?.(t("newTask.adopt.summaryNone", { error: firstError ?? "" }))
      return
    }
    if (adopted < total) ctx.notifyInfo?.(t("newTask.adopt.summaryPartial", { done: adopted, total }))
    else ctx.notifyInfo?.(t("newTask.adopt.summaryAll", { count: adopted }))
  } else {
    try {
      const task = await orch.createTask({
        repo,
        baseRef: result.baseRef,
        vendor: result.vendor,
        ...(result.modelEffort ? { modelEffort: result.modelEffort } : {}),
        ...(result.model ? { model: result.model } : {}),
        ...(result.tier ? { tier: result.tier } : {}),
      })
      createdId = task.id
    } catch (err) {
      ctx.logger.error(`${ctx.logPrefix} task.create failed:`, err)
      ctx.notifyError?.(t("tasks.toast.createFailed", { error: errorMessage(err) }))
      return
    }
  }
  await ctx.reload?.()
  if (createdId) {
    ctx.selectTask?.(createdId)
    await ctx.enterTask?.(createdId)
  }
}
