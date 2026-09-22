/**
 * Builds the `CreateTaskContext` the shared `tui/lib/task-actions` flows run
 * on (confirm copy, DIRTY_WORKTREE, errors live there). Only this host's
 * divergences are wired: dialogs, toasts, selection. No `reload`: this host
 * is render-driven.
 */

import { userFacingErrorMessage } from "@/lib/error-message"
import { useRenderer } from "@opentui/react"
import type { RemoteOrchestrator } from "../../client/remote-orchestrator.ts"
import { copyTextToSystemClipboard } from "../../tui/lib/clipboard-copy"
import {
  applyVendorChange,
  copyTaskFieldFlow,
  cycleVendorFlow,
  deleteTaskFlow,
  pickVendorFlow,
  renameTaskFlow,
  setStatusFlow,
} from "../../tui/lib/task-actions"
import { type CreateTaskContext, createTaskFlow } from "../../tui/lib/task-create-flow"
import type { Task, VendorId } from "../../types/task.ts"
import { BranchPickerDialog } from "../component/branch-picker-dialog"
import { EnginePickerDialog } from "../component/engine-picker-dialog"
import { FieldNotesDialog } from "../component/field-notes-dialog"
import { RunAgainDialog } from "../component/run-again-dialog"
import { StatusPickerDialog } from "../component/status-picker-dialog"
import type { DialogContext } from "../ui/dialog"
import { DialogConfirm } from "../ui/dialog-confirm"
import { buildBaseCreateTaskContext, selectNextAfterDelete } from "../ui/task-dialog-adapters"
import { landTaskAction } from "./land-task-action"
import { syncBaseAction } from "./sync-base-action"

export type WorkspaceTaskActionDeps = {
  orchestrator: RemoteOrchestrator
  tasks: () => readonly Task[]
  dialog: DialogContext
  notifyError: (message: string) => void
  notifyInfo: (message: string) => void
  /** Attention tone (yellow): it worked, but something needs a human next. */
  notifyNeedsInput: (message: string) => void
  /** Passed in, not `useT()`: the unit tests have no React render. */
  t: (key: string, params?: Record<string, string | number>) => string
  selectedId: () => string | null
  setSelectedId: (id: string | null) => void
  selectedTask: () => Task | undefined
  activateTask: (id: string) => Promise<void>
  /** Reclaim a deleted task's terminal-tab snapshot. */
  forgetTaskTabs: (taskId: string) => void
}

export type WorkspaceTaskActions = {
  createTask: () => Promise<void>
  deleteTask: (id: string) => Promise<void>
  renameTask: (id: string) => Promise<void>
  renameBranch: (id: string) => Promise<void>
  cycleVendor: (id: string) => Promise<void>
  /** Tree-menu "Change engine": `v`'s persist behind a picker. */
  pickVendor: (id: string) => Promise<void>
  /** ctrl+e engine pick: `cycleVendor`'s persist, silent on success. */
  setVendor: (id: string, vendor: VendorId) => Promise<void>
  togglePin: (id: string) => Promise<void>
  moveTask: (id: string, delta: -1 | 1) => Promise<void>
  /** Tree-menu "Set status" — a picker over the six board statuses. */
  setStatus: (id: string) => Promise<void>
  /** Tree-menu "Copy branch name" / "Copy path" — system clipboard + toast. */
  copyTaskField: (id: string, field: "branch" | "path") => void
  /** Project-row menu "Field notes" — read-only list of the repo's notes. */
  showFieldNotes: (repo: string) => void
  /** Row menu "Run again": the brief dialog; resolves the task to re-fire, or
   *  `undefined` on cancel. quick-fork's `runAgainTask` does the create. */
  confirmRunAgain: (id: string) => Promise<Task | undefined>
  /** Row menu "Land": the Worktrees page's `l`. No busy state: the row goes with its worktree. */
  landTask: (id: string) => Promise<void>
  /** Row menu "Sync with base": merge the base branch into the worktree. */
  syncBase: (id: string) => Promise<boolean>
}

export function useWorkspaceTaskActions(deps: WorkspaceTaskActionDeps): WorkspaceTaskActions {
  const { orchestrator, tasks, dialog, notifyError } = deps
  const renderer = useRenderer()
  const t = deps.t

  const taskActions: CreateTaskContext = {
    ...buildBaseCreateTaskContext({
      orch: orchestrator,
      tasks,
      dialog,
      notifyError,
      notifyInfo: deps.notifyInfo,
      selectedId: deps.selectedId,
      setSelectedId: deps.setSelectedId,
      logPrefix: "[rove workspace]",
      enterTask: deps.activateTask,
    }),
    // Pickers are adapters so the flows stay opentui-free.
    pickStatus: (current) => StatusPickerDialog.show(dialog, { current }),
    pickEngine: (opts) => EnginePickerDialog.show(dialog, opts),
    // Local pipe + OSC52 (the half that reaches the user's machine over SSH).
    copyText: (text) => copyTextToSystemClipboard(text, (payload) => renderer?.copyToClipboardOSC52(payload)),
    onTaskDeleted: (() => {
      // Reclaim the tab snapshot, THEN move selection off the deleted task.
      const moveSelection = selectNextAfterDelete({
        tasks,
        selectedId: deps.selectedId,
        setSelectedId: deps.setSelectedId,
      })
      return (taskId: string, nextTask: Task | undefined) => {
        deps.forgetTaskTabs(taskId)
        moveSelection(taskId, nextTask)
      }
    })(),
  }

  async function togglePin(id: string): Promise<void> {
    const task = tasks().find((t) => t.id === id)
    if (!task) return
    await orchestrator.setPinned(id, !task.pinned).catch((err) => {
      notifyError(t("tasks.toast.pinFailed", { error: userFacingErrorMessage(err) }))
    })
  }

  async function moveTask(id: string, delta: -1 | 1): Promise<void> {
    await orchestrator.moveTask(id, delta).catch((err) => {
      notifyError(t("tasks.toast.moveFailed", { error: userFacingErrorMessage(err) }))
    })
  }

  // `b`: branch-listing picker. `setBranch` rejects main/dir rows, so guard
  // before opening a picker that could only end in an error toast.
  async function renameBranch(id: string): Promise<void> {
    const task = tasks().find((t) => t.id === id)
    if (!task || task.kind === "main" || task.kind === "dir") return
    const next = await BranchPickerDialog.show(dialog, { currentBranch: task.branch, repo: task.repo })
    if (!next) return
    await orchestrator.setBranch(id, next).catch((err) => {
      notifyError(t("tasks.toast.renameBranchFailed", { branch: task.branch, error: userFacingErrorMessage(err) }))
    })
  }

  async function confirmRunAgain(id: string): Promise<Task | undefined> {
    const task = tasks().find((t) => t.id === id)
    // Only a stale row reaches here (the menu hides it without a brief).
    if (task?.prompt === undefined) return undefined
    const ok = await RunAgainDialog.show(dialog, { taskTitle: task.title, prompt: task.prompt })
    return ok === true ? task : undefined
  }

  // The land is `land-task-action.ts`; this is the host's dialog and toasts.
  async function landTask(id: string): Promise<void> {
    const task = tasks().find((candidate) => String(candidate.id) === id)
    if (!task) return
    await landTaskAction(
      {
        orchestrator,
        confirm: (body) =>
          DialogConfirm.show(
            dialog,
            t("worktrees.land.confirmTitle"),
            body,
            t("common.cancel"),
            t("worktrees.land.button"),
          ).then((ok: unknown) => ok === true),
        notifyInfo: deps.notifyInfo,
        notifyNeedsInput: deps.notifyNeedsInput,
        notifyError,
        t,
        callerCwd: process.cwd(),
      },
      id,
      task.branch || task.title,
    )
  }

  // No dialog: a merge from base is additive and `git merge --abort` undoes it.
  const syncBase = (id: string): Promise<boolean> =>
    syncBaseAction(
      { orchestrator, notifyInfo: deps.notifyInfo, notifyNeedsInput: deps.notifyNeedsInput, notifyError, t },
      id,
    )

  return {
    syncBase,
    createTask: () => createTaskFlow(taskActions),
    deleteTask: (id) => deleteTaskFlow(taskActions, id),
    renameTask: (id) => renameTaskFlow(taskActions, id),
    renameBranch,
    cycleVendor: (id) => cycleVendorFlow(taskActions, id),
    pickVendor: (id) => pickVendorFlow(taskActions, id),
    // Silent on success: the opened tab IS the new engine. Failures still toast.
    setVendor: async (id, vendor) => {
      await applyVendorChange(taskActions, id, vendor, { silentSuccess: true })
    },
    togglePin,
    moveTask,
    setStatus: (id) => setStatusFlow(taskActions, id),
    copyTaskField: (id, field) => {
      void copyTaskFieldFlow(taskActions, id, field)
    },
    showFieldNotes: (repo) => FieldNotesDialog.show(dialog, { repo, orchestrator }),
    confirmRunAgain,
    landTask,
  }
}
