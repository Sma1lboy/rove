/**
 * Quick-fork: seed the composer from the active task and create with the same
 * side effects as `createTaskFlow` (`addSavedRepo` + `setRepoLastActiveVendor`
 * before, select/enter after). Holds the pending first prompt: the composer
 * resolves on the SOURCE task's mount, the prompt must reach the NEW one's.
 * Shared by `TerminalTabs.tsx` and `host.tsx` so they can't diverge.
 */

import { userFacingErrorMessage } from "@/lib/error-message"
import { useState } from "react"
import { engineDisplayName } from "../../engine/interactive-command"
import { addSavedRepo } from "../../state/repos"
import { resolvePreferredVendor, setRepoLastActiveVendor } from "../../state/vendor-prefs"
import { t } from "../../tui/i18n"
import { appendAttachmentRefs } from "../../tui/lib/attachments"
import { DEFAULT_BASE_REF, getCurrentBranch } from "../../tui/lib/git-snapshot"
import { repoBasename } from "../../tui/panes/sidebar/groups"
import { DEFAULT_TASK_VENDOR, type Task, type VendorId } from "../../types/task"
import type { QuickTaskComposerOptions, QuickTaskResult } from "../component/quick-task-composer"
import { type RoundOrchestrator, runQuickForkRound } from "./quick-fork-round"

/**
 * `branchFrom` is the SOURCE TASK'S WORKTREE, not the main checkout: the child
 * branches off the parent's commits. Falls back to `repo`. Uncommitted work
 * does NOT come along.
 */
export function quickForkComposerOptions(
  repo: string,
  engines: readonly VendorId[],
  defaultVendor: VendorId,
  branchFrom: string = repo,
): QuickTaskComposerOptions {
  return {
    repoLabel: repoBasename(repo),
    engines,
    defaultVendor,
    defaultBaseRef: getCurrentBranch(branchFrom) ?? getCurrentBranch(repo) ?? DEFAULT_BASE_REF,
    engineLabel: engineDisplayName,
  }
}

/** Vendor to preselect: the repo's last-active engine, clamped to a detected one. */
export function quickForkDefaultVendor(repo: string, detected: readonly VendorId[]): VendorId {
  const pref = resolvePreferredVendor(repo)
  if (detected.length === 0 || detected.includes(pref)) return pref
  return detected[0] ?? pref
}

export interface QuickForkOrchestrator extends RoundOrchestrator {
  createTask(input: { repo: string; baseRef: string; vendor: VendorId }): Promise<Task>
  /** Record the brief on the created task — "Run again" only (see {@link runAgainTask}). */
  setPrompt(id: string, prompt: string): Promise<void>
}

/** Create, plus `createTaskFlow`'s side effects: vendor becomes the repo default, repo auto-saved. */
async function createQuickForkTask(
  orch: QuickForkOrchestrator,
  repo: string,
  baseRef: string,
  vendor: VendorId,
): Promise<Task> {
  setRepoLastActiveVendor(repo, vendor)
  addSavedRepo(repo)
  return orch.createTask({ repo, baseRef, vendor })
}

/** Create, then select + enter (`createTaskFlow`'s order). Errors go to
 *  `notifyError`, never thrown. Returns the new id, or undefined. */
async function runQuickFork(
  orch: QuickForkOrchestrator,
  repo: string,
  result: { baseRef: string; vendor: VendorId },
  hooks: {
    selectTask: (id: string) => void
    enterTask: (id: string) => Promise<void>
    notifyError: (message: string) => void
  },
): Promise<string | undefined> {
  try {
    const task = await createQuickForkTask(orch, repo, result.baseRef, result.vendor)
    hooks.selectTask(task.id)
    await hooks.enterTask(task.id)
    return task.id
  } catch (err) {
    console.error("[rove workspace] quick-fork task.create failed:", err)
    hooks.notifyError(t("tasks.toast.forkFailed", { error: userFacingErrorMessage(err) }))
    return undefined
  }
}

/**
 * "Run again": re-fire `task.prompt` as a NEW task with the source's repo,
 * engine and base ref, so only the worktree differs. The brief rides VERBATIM,
 * never through the composer, whose `stripNewlines` would flatten it.
 * Undefined when there is no brief or the create failed (already reported).
 */
export async function runAgainTask(
  orch: QuickForkOrchestrator,
  task: Task,
  hooks: {
    selectTask: (id: string) => void
    enterTask: (id: string) => Promise<void>
    notifyError: (message: string) => void
  },
): Promise<string | undefined> {
  const prompt = task.prompt
  if (prompt === undefined) return undefined
  // Same fork point as the source. `baseRef` is absent only on old records.
  const baseRef = task.baseRef ?? getCurrentBranch(task.worktreePath || task.repo) ?? DEFAULT_BASE_REF
  const vendor = task.vendor ?? DEFAULT_TASK_VENDOR
  const taskId = await runQuickFork(orch, task.repo, { baseRef, vendor }, hooks)
  if (taskId === undefined) return undefined
  // Child is re-runnable in turn. Best-effort: the prompt is already on its way.
  await orch.setPrompt(taskId, prompt).catch(() => undefined)
  return taskId
}

interface PendingInitialPrompt {
  readonly taskId: string
  readonly prompt: string
}

export interface UseQuickForkResult {
  /** Pass to `ShowWorkspace`'s `onQuickFork` prop. */
  readonly onQuickFork: (repo: string, result: QuickTaskResult) => void
  /** Pass to `initialPrompt`; undefined except for the task just forked. */
  readonly initialPromptFor: (taskId: string | undefined) => string | undefined
  /** Row menu "Run again", via the same pending slot. */
  readonly runAgain: (task: Task) => void
}

/** Holds the prompt until `TerminalTabs` remounts on the new task. A single
 *  slot, not a Map: `enterTask` lands first, so at most one is pending. */
export function useQuickFork(
  orch: QuickForkOrchestrator,
  hooks: {
    selectTask: (id: string) => void
    enterTask: (id: string) => Promise<void>
    notifyError: (message: string) => void
    notify: (message: string) => void
    t: (key: string, vars?: Record<string, string | number>) => string
  },
): UseQuickForkResult {
  const [pending, setPending] = useState<PendingInitialPrompt | null>(null)

  async function onQuickFork(repo: string, result: QuickTaskResult): Promise<void> {
    const prompt = appendAttachmentRefs(result.prompt, result.attachments)
    // A round is a different gesture (`quick-fork-round.ts`), not a loop over this one.
    if (result.attempts > 1) {
      const outcome = await runQuickForkRound(orch, repo, { ...result, prompt, attempts: result.attempts })
      if (outcome.failures.length > 0) {
        hooks.notifyError(
          `${hooks.t("quickTask.roundPartial", {
            ok: outcome.started.length,
            count: result.attempts,
            failed: outcome.failures.length,
          })}: ${outcome.failures.join("; ")}`,
        )
        return
      }
      hooks.notify(hooks.t("quickTask.startedRound", { count: outcome.started.length }))
      return
    }
    const taskId = await runQuickFork(orch, repo, result, hooks)
    if (taskId) setPending({ taskId, prompt })
  }

  async function onRunAgain(task: Task): Promise<void> {
    const taskId = await runAgainTask(orch, task, hooks)
    if (taskId && task.prompt !== undefined) setPending({ taskId, prompt: task.prompt })
  }

  function initialPromptFor(taskId: string | undefined): string | undefined {
    return taskId && pending?.taskId === taskId ? pending.prompt : undefined
  }

  return {
    onQuickFork: (repo, result) => void onQuickFork(repo, result),
    initialPromptFor,
    runAgain: (task) => void onRunAgain(task),
  }
}
