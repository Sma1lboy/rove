/**
 * Create/adopt flow behind the New task page. NO `@opentui` imports: the page
 * arrives only as the `promptNewTask` callback, so this runs under plain vitest.
 */

import { availableEngineIds } from "@/engine/account-detect"
import { errorMessage } from "@/lib/error-message"
import { addSavedRepo, getSavedRepos, resolveMainRepoRoot } from "@/state/repos"
import { t } from "@/tui/i18n"
import { DEFAULT_TASK_VENDOR, type VendorId } from "@/types/task"
import type { NewTaskDialogOptions, NewTaskInput } from "../component/new-task-dialog/state"
import type { TaskActionContext } from "./task-actions"

/** What the dialog hands the host when a new task starts from a first message. */
export interface FirstPromptStart {
  readonly prompt: string
  readonly vendor: VendorId
  readonly baseRef: string
  readonly modelEffort?: string
  readonly model?: string
  readonly tier?: string
  /** More repos the task spans, in pick order; `repo` stays the primary. */
  readonly extraRepos?: readonly string[]
}

/** Hosts build ONE of these and pass it to every flow. */
export interface CreateTaskContext extends TaskActionContext {
  /** New-task form adapter — the host shows its New task page and resolves with the answer. */
  readonly promptNewTask: (
    defaultRepo: string,
    repos: readonly string[],
    opts: NewTaskDialogOptions,
  ) => Promise<NewTaskInput | undefined>
  /** Vendor preference — see state/vendor-prefs.ts. */
  readonly lastVendor: () => VendorId | undefined
  readonly rememberVendor: (vendor: VendorId) => void
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
  /**
   * Create the task with its first message and run its engine on it. Absent → the message is
   * dropped and the task is created empty.
   */
  readonly startWithPrompt?: (repo: string, start: FirstPromptStart) => void
  /** Open the created task's engine tab before it is entered. Absent → the pane spawns it on mount. */
  readonly openEngine?: (taskId: string) => Promise<void>
  /** No folder: open a session in no project on `vendor`, seeded with `prompt`. Absent → the pick is dropped. */
  readonly openScratch?: (vendor: VendorId, prompt?: string, pick?: { model?: string; modelEffort?: string }) => void
}

/** "Creating task…" and the failure that ends it share one toast slot, so a failure never sits under a ✓. */
const CREATE_TOAST = "task-create"

/** The saved projects, trailing slashes trimmed as the sidebar groups them. */
function projectSet(repos: readonly string[]): ReadonlySet<string> {
  return new Set(repos.map((repo) => repo.trim().replace(/[\\/]+$/, "")).filter(Boolean))
}

/** A repo path as its main checkout; a path git cannot read stays as given, for the daemon to refuse by name. */
function mainRoot(repo: string): string {
  try {
    return resolveMainRepoRoot(repo)
  } catch {
    return repo
  }
}

/** Where a new task starts when the caller already knows: a task's repo and branch, to stack on it. */
export interface CreateTaskSeed {
  readonly repo: string
  /** Absent = the project's own default base. */
  readonly baseRef?: string
}

/** Default repo → dialog → persist vendor + repo → create / adopt / open → select and enter. */
export async function createTaskFlow(ctx: CreateTaskContext, seed?: CreateTaskSeed): Promise<void> {
  const repos = getSavedRepos()
  // Without a seed the page opens on No folder (""), never on a guess from the selected task.
  const defaultRepo = seed?.repo ?? ""
  const defaultVendor = ctx.lastVendor() ?? DEFAULT_TASK_VENDOR
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
    // "Open the project" is offered only for these.
    mainRepos: projectSet(repos),
    ...(seed?.baseRef ? { initialBaseRef: seed.baseRef } : {}),
  })
  if (!result) return
  if (result.mode === "scratch") {
    ctx.rememberVendor(result.vendor)
    const { model, modelEffort } = result
    ctx.openScratch?.(result.vendor, result.prompt, {
      ...(model ? { model } : {}),
      ...(modelEffort ? { modelEffort } : {}),
    })
    return
  }
  // Auto-save keeps `add` optional. Use the returned git toplevel so a
  // subdirectory entry is keyed under the same root the task record gets.
  const repo = addSavedRepo(result.repo).path
  // The extras are keyed by their main checkout like the primary, so a subdirectory or a linked worktree names its repo.
  const extraRepos = result.mode === "adopt" || result.mode === "open" ? [] : (result.extraRepos ?? []).map(mainRoot)
  ctx.rememberVendor(result.vendor)
  ctx.onRepoSaved?.()
  if (!orch) {
    // The dialog is already closed; without a toast this reads as silent success.
    ctx.logger.error(`${ctx.logPrefix} no daemon; cannot create task`)
    ctx.notifyError?.(t("tasks.toast.noDaemonWorktree"))
    return
  }
  // "Open the project": a new session in the repo's OWN checkout, no worktree.
  if (result.mode === "open") {
    try {
      const session = await orch.openDirectoryTask({ dir: await orch.ensureProject(repo), vendor: result.vendor })
      await ctx.reload?.()
      ctx.selectTask?.(session.id)
      await ctx.enterTask?.(session.id)
    } catch (err) {
      ctx.logger.error(`${ctx.logPrefix} open project failed:`, err)
      ctx.notifyError?.(t("newTask.open.failed", { error: errorMessage(err) }))
    }
    return
  }
  // A task with a first message is born by it: the host's quick-start path creates it and
  // delivers the message to its engine, which the bare `createTask` below cannot.
  if (result.mode !== "adopt" && result.prompt && ctx.startWithPrompt) {
    ctx.startWithPrompt(repo, {
      prompt: result.prompt,
      vendor: result.vendor,
      baseRef: result.baseRef,
      ...(result.modelEffort ? { modelEffort: result.modelEffort } : {}),
      ...(result.model ? { model: result.model } : {}),
      ...(result.tier ? { tier: result.tier } : {}),
      ...(extraRepos.length > 0 ? { extraRepos } : {}),
    })
    return
  }
  // The git-worktree op has no other feedback once the dialog vanishes.
  ctx.notifyInfo?.("Creating task…", { key: CREATE_TOAST })
  let createdId: string | undefined
  let engineFailed = false
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
        ...(extraRepos.length > 0 ? { extraRepos: extraRepos.map((repo) => ({ repo })) } : {}),
      })
      createdId = task.id
    } catch (err) {
      ctx.logger.error(`${ctx.logPrefix} task.create failed:`, err)
      ctx.notifyError?.(t("tasks.toast.createFailed", { error: errorMessage(err) }), { key: CREATE_TOAST })
      return
    }
    // The engine starts with the create, not when the row is entered. A failed start keeps the row, selected
    // but not entered: entering respawns the engine, so ⏎ on the row is the retry, never an unasked one.
    await ctx.openEngine?.(createdId).catch((err: unknown) => {
      engineFailed = true
      ctx.logger.error(`${ctx.logPrefix} engine start failed:`, err)
      ctx.notifyError?.(t("tasks.toast.engineStartFailed"), {
        key: CREATE_TOAST,
        hint: t("tasks.toast.engineStartRetry", { error: errorMessage(err) }),
      })
    })
  }
  await ctx.reload?.()
  if (createdId) {
    ctx.selectTask?.(createdId)
    if (!engineFailed) await ctx.enterTask?.(createdId)
  }
}
