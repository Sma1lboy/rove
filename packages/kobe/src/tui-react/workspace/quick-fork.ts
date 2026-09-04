/**
 * Quick-fork — resolve the composer's seed defaults from the active task,
 * and drive `orch.createTask` with the same side effects
 * `quick-task/host.tsx` and the shared `createTaskFlow`
 * (`tui/lib/task-actions.ts`) both perform: `addSavedRepo` + `setRepoLastActiveVendor`
 * before create, `selectTask`/`enterTask` after. Also owns the phase-2
 * first-prompt handoff (`useQuickFork`): the composer resolves on the
 * SOURCE task's TerminalTabs mount, but the prompt has to reach the
 * NEW task's mount, so the pending prompt is held here, keyed by task id.
 *
 * Its own module because BOTH `TerminalTabs.tsx` and `host.tsx` drive this
 * gesture: the create/enter/pending-prompt shape must not exist twice, or the
 * two entry points diverge on the side effects above.
 */

import { errorMessage } from "@/lib/error-message"
import { useState } from "react"
import { engineDisplayName } from "../../engine/interactive-command"
import { addSavedRepo } from "../../state/repos"
import { resolvePreferredVendor, setRepoLastActiveVendor } from "../../state/vendor-prefs"
import { appendAttachmentRefs } from "../../tui/lib/attachments"
import { DEFAULT_BASE_REF, getCurrentBranch } from "../../tui/lib/git-snapshot"
import { repoBasename } from "../../tui/panes/sidebar/groups"
import { DEFAULT_TASK_VENDOR, type Task, type VendorId } from "../../types/task"
import type { QuickTaskComposerOptions, QuickTaskResult } from "../component/quick-task-composer"
import { type RoundOrchestrator, runQuickForkRound } from "./quick-fork-round"

/**
 * Seed the composer from the task a quick-fork chord fired in.
 *
 * `branchFrom` is the SOURCE TASK'S WORKTREE, not the main checkout: a fork
 * is "carry on from where I am", so the child branches off the parent task's
 * branch (with its commits), not off whatever the main checkout happens to
 * have checked out. Falls back to `repo` for callers without a worktree.
 * Uncommitted work in the parent does NOT come along — commit it first.
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

/**
 * Create the forked task and apply the same side effects
 * `createTaskFlow`/`quick-task/host.tsx` apply on submit: remember the
 * picked vendor as the repo's new default and auto-save the repo.
 */
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

/**
 * Full quick-fork submit flow: create the task, then land the host's
 * selection/entry on it — the same "select then enter" order
 * `createTaskFlow` ends on. Errors are reported via `notifyError`, never
 * thrown. Returns the created task's id (undefined on failure) so the
 * caller can hand its first-prompt delivery to the new task's TerminalTabs
 * mount (phase 2).
 */
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
    hooks.notifyError(`Couldn't fork task: ${errorMessage(err)}`)
    return undefined
  }
}

/**
 * Re-fire a task's stored brief as a NEW task ("Run again", row menu).
 *
 * Rove records the delivered `add --prompt` text on the task (`task.prompt`)
 * precisely so an attempt that went wrong can be re-run clean. The child is a
 * quick-fork with the SOURCE's own inputs — same repo, same engine,
 * cut from the base ref the source was cut from — so the only difference
 * between the two runs is the worktree.
 *
 * The brief rides the create path VERBATIM. It must not be routed through the
 * quick-task composer: that field is a single-line input running
 * `stripNewlines`, which would silently flatten a multi-line brief and re-run
 * something the user never wrote.
 *
 * Returns the new task's id, or undefined when the source has no stored brief
 * or the create failed (`runQuickFork` already reported it).
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
  // Same fork point as the source, so a re-run compares against the same base.
  // `baseRef` is only absent on records predating the field (types/task.ts) —
  // fall back to the live branch the way `quickForkComposerOptions` does.
  const baseRef = task.baseRef ?? getCurrentBranch(task.worktreePath || task.repo) ?? DEFAULT_BASE_REF
  const vendor = task.vendor ?? DEFAULT_TASK_VENDOR
  const taskId = await runQuickFork(orch, task.repo, { baseRef, vendor }, hooks)
  if (taskId === undefined) return undefined
  // Copy the brief onto the child so it is re-runnable in turn, and so
  // `rove api get-task` reports the text its engine is being handed.
  // Best-effort: the prompt is already on its way to the tab, and a failed
  // persist must not turn a created task into an error.
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
  /** Pass to `ShowWorkspace`'s `initialPrompt` prop, gated on the currently
   *  selected task — undefined for every task except the one just forked. */
  readonly initialPromptFor: (taskId: string | undefined) => string | undefined
  /** Row menu "Run again": create the child and hand it the source's brief
   *  through the same pending slot the composer's forks use. */
  readonly runAgain: (task: Task) => void
}

/**
 * Host-level quick-fork wiring: runs the create+enter flow, then holds the
 * prompt for the ONE render cycle it takes `ShowWorkspace` to remount
 * `TerminalTabs` on the new task (a plain `{ taskId, prompt } | null`, not
 * a Map — `runQuickFork`'s `enterTask` lands `selectedTask` on the new task
 * first, so at most one prompt is ever pending).
 */
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
    // A round (attempts > 1) is a different gesture, not a loop over this one:
    // it does not steal focus and it cannot ride the single pending slot. See
    // `quick-fork-round.ts`. One attempt keeps today's behaviour exactly.
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
