/**
 * Workspace-host task-action wiring. Builds the `CreateTaskContext` the
 * shared `tui/lib/task-actions` flows run on — confirm copy, DIRTY_WORKTREE
 * force-delete branch and error handling all live there, so no host drifts —
 * and returns the host's action callbacks.
 *
 * Only this host's genuine divergences are wired here: dialog surfacing
 * (`DialogConfirm`/`RenameTaskDialog`/`NewTaskDialog`), toast notifications
 * and selection. No `openCreateSurface` (the in-pane NewTaskDialog IS the
 * surface), no `reload` (this host is fully render-driven).
 *
 * `tasks` / `selectedId` / `selectedTask` are passed as getter closures over
 * the latest render's value (`() => tasks`), the shape the flows expect
 * (`TaskActionContext.tasks` is `() => readonly Task[]`).
 */

import { userFacingErrorMessage } from "@/lib/error-message"
import { useRenderer } from "@opentui/react"
import type { RemoteOrchestrator } from "../../client/remote-orchestrator.ts"
import { availableEngineIds } from "../../engine/account-detect"
import { t } from "../../tui/i18n"
import { copyTextToSystemClipboard } from "../../tui/lib/clipboard-copy"
import {
  applyVendorChange,
  copyTaskFieldFlow,
  cycleVendorFlow,
  deleteTaskFlow,
  renameTaskFlow,
  setStatusFlow,
} from "../../tui/lib/task-actions"
import { type CreateTaskContext, createTaskFlow } from "../../tui/lib/task-create-flow"
import { DEFAULT_TASK_VENDOR, type Task, type VendorId } from "../../types/task.ts"
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
  /** The host's live translator — passed in rather than pulled from `useT()`,
   *  which would tie this hook to a React render its unit tests do not have. */
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
  /** Tree-menu "Change engine" — `v`'s persist behind a picker over the
   *  available engines instead of the chord's blind cycle. */
  pickVendor: (id: string) => Promise<void>
  /** ctrl+e picker's engine pick — same persist as `cycleVendor`, but silent
   *  on success: the tab it opens already shows the result. */
  setVendor: (id: string, vendor: VendorId) => Promise<void>
  togglePin: (id: string) => Promise<void>
  moveTask: (id: string, delta: -1 | 1) => Promise<void>
  /** Tree-menu "Set status" — a picker over the six board statuses. */
  setStatus: (id: string) => Promise<void>
  /** Tree-menu "Copy branch name" / "Copy path" — system clipboard + toast. */
  copyTaskField: (id: string, field: "branch" | "path") => void
  /** Project-row menu "Field notes" — read-only list of the repo's notes. */
  showFieldNotes: (repo: string) => void
  /**
   * Row menu "Run again" — show the task's stored brief and resolve the task
   * to re-fire once the user commits, or `undefined` on cancel. The CREATE is
   * quick-fork's (`runAgainTask`), which owns the first-prompt handoff into
   * the new task's mount; this half is the dialog and the lookup.
   */
  confirmRunAgain: (id: string) => Promise<Task | undefined>
  /** Row menu "Land into base branch" — the Worktrees page's `l` reachable
   *  from the row. No busy state: the row goes with its worktree. */
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
    // The set-status picker, supplied as an adapter so `setStatusFlow` stays
    // opentui-free like every other flow (task-actions.ts's testability rule).
    pickStatus: (current) => StatusPickerDialog.show(dialog, { current }),
    // The clipboard writer, supplied the same way: both channels the terminal
    // pane's copy-on-select uses (local pbcopy-style pipe + OSC52 through the
    // renderer, which is the half that reaches the user's machine over SSH).
    copyText: (text) => copyTextToSystemClipboard(text, (payload) => renderer?.copyToClipboardOSC52(payload)),
    onTaskDeleted: (() => {
      // Reclaim the deleted task's terminal-tab snapshot, THEN move the
      // host cursor off it (the shared selection move — the base's bare
      // `selectNextAfterDelete` overridden with this wrapper).
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

  // Set-branch (`b`): pick from the repo's local branches (filter-as-you-type)
  // or type a new name — the shared `renameBranchFlow`'s bare text prompt
  // replaced by the branch-listing dialog. `setBranch` no-ops on
  // an unchanged name and rejects main/dir rows, so we guard/notify here:
  // opening the picker for a task whose branch can't be set would send the
  // user through a choice that only ever ends in the error toast.
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
    // The menu withholds the entry from a task with no stored brief
    // (tree-menu.ts), so this only fires on a stale row.
    if (task?.prompt === undefined) return undefined
    const ok = await RunAgainDialog.show(dialog, { taskTitle: task.title, prompt: task.prompt })
    return ok === true ? task : undefined
  }

  async function pickVendor(id: string): Promise<void> {
    const task = tasks().find((t) => t.id === id)
    if (!task) return
    const current = task.vendor ?? DEFAULT_TASK_VENDOR
    const engines = await availableEngineIds()
    const pick = await EnginePickerDialog.show(dialog, {
      engines: engines.length > 0 ? engines : [current],
      current,
      currentEffort: task.modelEffort,
    })
    if (!pick) return
    // Not `pick.vendor === current` — re-picking the same engine at a
    // different reasoning level is a real change, which that comparison
    // would swallow.
    if (pick.vendor === current && (pick.effort === undefined || pick.effort === (task.modelEffort ?? ""))) return
    await applyVendorChange(taskActions, id, pick.vendor, { effort: pick.effort })
  }

  // Row menu "Land into base branch". The land itself is shared with the
  // Worktrees page (`land-task-action.ts`); this is only the host's dialog,
  // toasts and row lookup — the same division `pickVendor` follows.
  async function landTask(id: string): Promise<void> {
    const task = tasks().find((candidate) => String(candidate.id) === id)
    if (!task) return
    await landTaskAction(
      {
        orchestrator,
        // Body arrives rendered from `landTaskAction` — it names the
        // destination branch and commit count, which the preflight owns.
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

  // Row menu "Sync with base" — no dialog (a merge from the base is additive
  // and `git merge --abort` undoes it), so this is only the notifier wiring.
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
    pickVendor,
    // The ctrl+e picker's engine pick. Silent on success: the tab it just
    // opened IS the new engine, so a toast saying the change "applies on
    // reopen" would contradict what the user is looking at. Failures
    // still toast — see applyVendorChange.
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
