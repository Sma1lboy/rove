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
import { FORK_UNSUPPORTED_CODE } from "../../orchestrator/errors"
import type { SpawnChildInput } from "../../orchestrator/spawn-child"
import { deriveTitleFromPrompt } from "../../orchestrator/title"
import { addSavedRepo } from "../../state/repos"
import { resolvePreferredVendor, setRepoLastActiveVendor } from "../../state/vendor-prefs"
import { t } from "../../tui/i18n"
import { appendAttachmentRefs } from "../../tui/lib/attachments"
import { DEFAULT_BASE_REF, getCurrentBranch } from "../../tui/lib/git-snapshot"
import { repoBasename } from "../../tui/panes/sidebar/groups"
import type { TabsState } from "../../tui/workspace/terminal-tabs-core"
import { DEFAULT_TASK_VENDOR, type Task, type VendorId } from "../../types/task"
import type { QuickTaskComposerOptions, QuickTaskResult } from "../component/quick-task-composer"
import { type RoundOrchestrator, runQuickForkRound } from "./quick-fork-round"
import { setTaskTabs } from "./terminal-tabs-shared"

/**
 * `branchFrom` is the SOURCE TASK'S WORKTREE, not the main checkout: the child
 * branches off the parent's commits. Falls back to `repo`. Uncommitted work
 * comes along only when the fork is a clone ({@link QuickForkSource}); a plain
 * new task leaves it behind.
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

/** The engine fields a new task can be created with beyond its vendor. */
interface EngineFields {
  readonly modelEffort?: string
  readonly model?: string
  readonly tier?: string
  /** The sidebar name: the first prompt, so the row is not left as the placeholder. */
  readonly title?: string
  /** More repos the task spans, in pick order (the repo it is created on is the primary). */
  readonly extraRepos?: readonly string[]
  /** Clone this task's worktree (uncommitted work included) instead of cutting a fresh one. */
  readonly forkFrom?: string
}

/** The task a quick-fork was started from, and the branch the composer offered as its base. */
export interface QuickForkSource {
  readonly taskId: string
  /** Absent when the source sits on a detached HEAD, which a clone cannot be offered for. */
  readonly branch: string | null
}

export interface QuickForkOrchestrator extends RoundOrchestrator {
  createTask(
    input: { repo: string; baseRef: string; vendor: VendorId } & Omit<EngineFields, "extraRepos" | "forkFrom"> & {
        forkFrom?: string
        extraRepos?: readonly { repo: string; baseRef?: string }[]
      },
  ): Promise<Task>
  /** Record the brief on the created task — "Run again" only (see {@link runAgainTask}). */
  setPrompt(id: string, prompt: string): Promise<void>
  spawnChildTask(input: SpawnChildInput): Promise<{ readonly task: Task }>
}

/** Create, plus `createTaskFlow`'s side effects: vendor becomes the repo default, repo auto-saved. */
async function createQuickForkTask(
  orch: QuickForkOrchestrator,
  repo: string,
  baseRef: string,
  vendor: VendorId,
  fields: EngineFields = {},
  onForkRefused?: (reason: string) => void,
): Promise<Task> {
  setRepoLastActiveVendor(repo, vendor)
  addSavedRepo(repo)
  const input = {
    repo,
    baseRef,
    vendor,
    ...(fields.modelEffort ? { modelEffort: fields.modelEffort } : {}),
    ...(fields.model ? { model: fields.model } : {}),
    ...(fields.tier ? { tier: fields.tier } : {}),
    ...(fields.title ? { title: fields.title } : {}),
    ...(fields.extraRepos?.length ? { extraRepos: fields.extraRepos.map((repo) => ({ repo })) } : {}),
  }
  if (!fields.forkFrom) return orch.createTask(input)
  try {
    return await orch.createTask({ ...input, forkFrom: fields.forkFrom })
  } catch (err) {
    // A refused clone creates nothing: fall back to a plain new task and say what stays behind.
    const message = userFacingErrorMessage(err)
    if (!message.includes(FORK_UNSUPPORTED_CODE)) throw err
    onForkRefused?.(message.replace(`${FORK_UNSUPPORTED_CODE}: `, ""))
    return orch.createTask(input)
  }
}

/** Create, then select + enter (`createTaskFlow`'s order). Errors go to
 *  `notifyError`, never thrown. Returns the new id, or undefined. */
export async function runQuickFork(
  orch: QuickForkOrchestrator,
  repo: string,
  result: { baseRef: string; vendor: VendorId } & EngineFields,
  hooks: {
    selectTask: (id: string) => void
    enterTask: (id: string) => Promise<void>
    notifyError: (message: string) => void
    /** Told when a requested clone was refused and the task started from the last commit instead. */
    notify?: (message: string) => void
  },
): Promise<string | undefined> {
  try {
    const task = await createQuickForkTask(orch, repo, result.baseRef, result.vendor, result, (reason) =>
      hooks.notify?.(t("tasks.toast.forkLeftBehind", { reason })),
    )
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

/** Spawn a shared child, then select + enter it (quick-fork's order). Errors go to `notifyError`, never thrown. */
export async function runSpawnChild(
  orch: Pick<QuickForkOrchestrator, "spawnChildTask">,
  request: ChildSpawnRequest,
  hooks: {
    selectTask: (id: string) => void
    enterTask: (id: string) => Promise<void>
    notifyError: (message: string) => void
  },
): Promise<string | undefined> {
  try {
    const { task } = await orch.spawnChildTask({
      parentTaskId: request.parentTaskId,
      worktree: false,
      vendor: request.vendor,
      ...(request.title ? { title: request.title } : {}),
    })
    // Before the child is shown: its first mount reads these.
    if (request.tabs) setTaskTabs(task.id, request.tabs)
    hooks.selectTask(task.id)
    await hooks.enterTask(task.id)
    return task.id
  } catch (err) {
    console.error("[rove workspace] spawn child task failed:", err)
    hooks.notifyError(t("tasks.toast.childFailed", { error: userFacingErrorMessage(err) }))
    return undefined
  }
}

interface PendingInitialPrompt {
  readonly taskId: string
  readonly prompt: string
}

/** A second conversation next to `parentTaskId`'s own: a child sharing its directory. */
export interface ChildSpawnRequest {
  readonly parentTaskId: string
  readonly vendor: VendorId
  /** The child's first prompt, held in the same slot as a quick-fork's. */
  readonly prompt?: string
  /** The child's first tab, written before it is shown (a native fork of the parent's session). */
  readonly tabs?: TabsState
  /** The child's row title; absent = the placeholder a first prompt later replaces. */
  readonly title?: string
}

export interface UseQuickForkResult {
  /** Pass to `ShowWorkspace`'s `onQuickFork` prop. */
  readonly onQuickFork: (repo: string, result: QuickTaskResult, source?: QuickForkSource) => void
  /** ctrl+t, the picker's tab destination and the sidebar's "New conversation". */
  readonly onSpawnChild: (request: ChildSpawnRequest) => void
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

  async function onQuickFork(repo: string, result: QuickTaskResult, source?: QuickForkSource): Promise<void> {
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
    const taskId = await runQuickFork(
      orch,
      repo,
      {
        ...result,
        title: deriveTitleFromPrompt(prompt),
        // A different base than the source's own branch means the user asked for something other than "continue from here".
        ...(source && source.branch !== null && result.baseRef === source.branch ? { forkFrom: source.taskId } : {}),
      },
      {
        ...hooks,
        selectTask: (id) => {
          // Selection can mount the engine immediately; its first spawn owns the prompt.
          setPending({ taskId: id, prompt })
          hooks.selectTask(id)
        },
      },
    )
    // The brief makes the task re-runnable ("Run again"); best-effort, the prompt is already on its way.
    if (taskId) await orch.setPrompt(taskId, prompt).catch(() => undefined)
  }

  async function onRunAgain(task: Task): Promise<void> {
    const taskId = await runAgainTask(orch, task, hooks)
    if (taskId && task.prompt !== undefined) setPending({ taskId, prompt: task.prompt })
  }

  function initialPromptFor(taskId: string | undefined): string | undefined {
    return taskId && pending?.taskId === taskId ? pending.prompt : undefined
  }

  /** Sharing the parent's directory needs no repo or branch choice, so the picker's pick is the whole input. */
  async function onSpawnChild(request: ChildSpawnRequest): Promise<void> {
    await runSpawnChild(orch, request, {
      ...hooks,
      selectTask: (taskId) => {
        if (request.prompt !== undefined) setPending({ taskId, prompt: request.prompt })
        hooks.selectTask(taskId)
      },
    })
  }

  return {
    onQuickFork: (repo, result, source) => void onQuickFork(repo, result, source),
    onSpawnChild: (request) => void onSpawnChild(request),
    initialPromptFor,
    runAgain: (task) => void onRunAgain(task),
  }
}
