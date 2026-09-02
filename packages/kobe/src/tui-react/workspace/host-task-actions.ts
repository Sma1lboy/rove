/**
 * Workspace-host task-action wiring — React port of `tui/workspace/
 * host-task-actions.ts` (issue #16 React migration). Builds the
 * `CreateTaskContext` the shared `tui/lib/task-actions` flows run on (the
 * SAME framework-free flows the Solid host and the tmux Tasks pane use —
 * confirm copy, DIRTY_WORKTREE force-delete branch, error handling all
 * live there so no host drifts) and returns the host's action callbacks.
 *
 * Only this host's genuine divergences are wired here: dialog surfacing
 * (the React `DialogConfirm`/`RenameTaskDialog`/`NewTaskDialog`), toast
 * notifications and selection. No `openCreateSurface` (the in-pane NewTaskDialog IS the
 * surface), no `reload` (this host is fully render-driven).
 *
 * Solid→React deltas: every accessor prop (`tasks`, `selectedId`,
 * `selectedTask`) becomes a plain getter closure over the latest render's
 * value — callers pass `() => tasks` / `() => selectedId` etc. from the
 * host, same shape the flows already expect (`TaskActionContext.tasks` is
 * `() => readonly Task[]`), so this file's body is otherwise unchanged
 * from the Solid original.
 */

import { errorMessage } from "@/lib/error-message"
import { useRenderer } from "@opentui/react"
import type { RemoteOrchestrator } from "../../client/remote-orchestrator.ts"
import { availableEngineIds } from "../../engine/account-detect"
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
import { StatusPickerDialog } from "../component/status-picker-dialog"
import type { DialogContext } from "../ui/dialog"
import { buildBaseCreateTaskContext, selectNextAfterDelete } from "../ui/task-dialog-adapters"

export type WorkspaceTaskActionDeps = {
  orchestrator: RemoteOrchestrator
  tasks: () => readonly Task[]
  dialog: DialogContext
  notifyError: (message: string) => void
  notifyInfo: (message: string) => void
  selectedId: () => string | null
  setSelectedId: (id: string | null) => void
  selectedTask: () => Task | undefined
  activateTask: (id: string) => Promise<void>
  /** Reclaim a deleted task's terminal-tab snapshot (O19). */
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
}

export function useWorkspaceTaskActions(deps: WorkspaceTaskActionDeps): WorkspaceTaskActions {
  const { orchestrator, tasks, dialog, notifyError } = deps
  const renderer = useRenderer()

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
      // Reclaim the deleted task's terminal-tab snapshot (O19), THEN move the
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
      notifyError(`Couldn't pin: ${errorMessage(err)}`)
    })
  }

  async function moveTask(id: string, delta: -1 | 1): Promise<void> {
    await orchestrator.moveTask(id, delta).catch((err) => {
      notifyError(`Couldn't move: ${errorMessage(err)}`)
    })
  }

  // Set-branch (`b`): pick from the repo's local branches (filter-as-you-type)
  // or type a new name — the shared `renameBranchFlow`'s bare text prompt
  // replaced by the branch-listing dialog (issue #10). `setBranch` no-ops on
  // an unchanged name and rejects main/dir rows, so we guard/notify here:
  // opening the picker for a task whose branch can't be set would send the
  // user through a choice that only ever ends in the error toast.
  async function renameBranch(id: string): Promise<void> {
    const task = tasks().find((t) => t.id === id)
    if (!task || task.kind === "main" || task.kind === "dir") return
    const next = await BranchPickerDialog.show(dialog, { currentBranch: task.branch, repo: task.repo })
    if (!next) return
    await orchestrator.setBranch(id, next).catch((err) => {
      notifyError(`Couldn't rename branch: ${errorMessage(err)}`)
    })
  }

  async function pickVendor(id: string): Promise<void> {
    const task = tasks().find((t) => t.id === id)
    if (!task) return
    const current = task.vendor ?? DEFAULT_TASK_VENDOR
    const engines = await availableEngineIds()
    const next = await EnginePickerDialog.show(dialog, { engines: engines.length > 0 ? engines : [current], current })
    if (!next || next === current) return
    await applyVendorChange(taskActions, id, next)
  }

  return {
    createTask: () => createTaskFlow(taskActions),
    deleteTask: (id) => deleteTaskFlow(taskActions, id),
    renameTask: (id) => renameTaskFlow(taskActions, id),
    renameBranch,
    cycleVendor: (id) => cycleVendorFlow(taskActions, id),
    pickVendor,
    // The ctrl+e picker's engine pick. Silent on success: the tab it just
    // opened IS the new engine, so a toast saying the change "applies on
    // reopen" contradicted what the user was already looking at. Failures
    // still toast — see applyVendorChange.
    setVendor: async (id, vendor) => {
      await applyVendorChange(taskActions, id, vendor, { silentSuccess: true })
    },
    togglePin,
    moveTask,
    setStatus: (id) => setStatusFlow(taskActions, id),
    copyTaskField: (id, field) => copyTaskFieldFlow(taskActions, id, field),
    showFieldNotes: (repo) => FieldNotesDialog.show(dialog, { repo, load: () => orchestrator.listFieldNotes(repo) }),
  }
}
