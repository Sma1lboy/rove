/**
 * `CreateTaskContext` wiring shared by both task-action hosts (workspace and
 * Tasks pane), one copy so they can't drift. Pure wiring: behavior lives in
 * `tui/lib/task-actions` + `tui/lib/task-create-flow`.
 */

import type { RemoteOrchestrator } from "../../client/remote-orchestrator.ts"
import { resolvePreferredVendor, setRepoLastActiveVendor } from "../../state/vendor-prefs.ts"
import type { ConfirmPrompt, TextPromptOpts } from "../../tui/lib/task-actions"
import type { CreateTaskContext } from "../../tui/lib/task-create-flow"
import type { Task, VendorId } from "../../types/task.ts"
import { NewTaskDialog, type NewTaskDialogOptions } from "../component/new-task-dialog"
import { RenameTaskDialog } from "../component/rename-task-dialog"
import type { DialogContext } from "./dialog"
import { DialogConfirm } from "./dialog-confirm"

/** The three dialog-surfacing callbacks of `TaskActionContext`/`CreateTaskContext`. */
function taskDialogAdapters(dialog: DialogContext): {
  confirm: (p: ConfirmPrompt) => Promise<boolean>
  promptText: (initial: string, opts?: TextPromptOpts) => Promise<string | undefined>
  promptNewTask: (
    defaultRepo: string,
    repos: readonly string[],
    opts: NewTaskDialogOptions,
  ) => ReturnType<typeof NewTaskDialog.show>
} {
  return {
    confirm: async (p) =>
      (await DialogConfirm.show(dialog, p.title, p.body, p.cancelLabel, p.confirmLabel, { danger: p.danger })) === true,
    promptText: (initial, opts) => RenameTaskDialog.show(dialog, initial, opts),
    promptNewTask: (defaultRepo, repos, opts) => NewTaskDialog.show(dialog, defaultRepo, repos, opts),
  }
}

/** The repo-scoped vendor preference pair (state/vendor-prefs.ts). */
const vendorPrefAdapters = {
  lastVendor: (repo: string): VendorId | undefined => resolvePreferredVendor(repo),
  rememberVendor: (repo: string, vendor: VendorId): void => setRepoLastActiveVendor(repo, vendor),
} as const

/** Move the cursor off a deleted task: flow's next, else first remaining, else clear. */
export function selectNextAfterDelete(args: {
  readonly tasks: () => readonly Task[]
  readonly selectedId: () => string | null
  readonly setSelectedId: (id: string | null) => void
}): (taskId: string, nextTask: Task | undefined) => void {
  return (taskId, nextTask) => {
    if (args.selectedId() !== taskId) return
    const remaining = args.tasks()
    args.setSelectedId(nextTask?.id ?? remaining[0]?.id ?? null)
  }
}

/** Deps for {@link buildBaseCreateTaskContext} — the wiring both hosts already own. */
export interface BaseCreateTaskContextDeps {
  readonly orch: RemoteOrchestrator | null
  readonly tasks: () => readonly Task[]
  readonly dialog: DialogContext
  readonly notifyError: (message: string) => void
  readonly notifyInfo: (message: string) => void
  readonly selectedId: () => string | null
  readonly setSelectedId: (id: string | null) => void
  /** Forensic log tag — `[rove tasks]` (Tasks pane) vs `[rove workspace]`. */
  readonly logPrefix: string
  /** Enter (switch into) a task — the pane's `switchTo` / the workspace's `activateTask`. */
  readonly enterTask: (id: string) => Promise<void>
}

/** The `CreateTaskContext` base both hosts spread, overriding only real divergences. */
export function buildBaseCreateTaskContext(deps: BaseCreateTaskContextDeps): CreateTaskContext {
  return {
    orch: deps.orch,
    tasks: () => deps.tasks(),
    ...taskDialogAdapters(deps.dialog),
    ...vendorPrefAdapters,
    logger: console,
    logPrefix: deps.logPrefix,
    notifyError: deps.notifyError,
    notifyInfo: deps.notifyInfo,
    // Publish the shared active-task focus so every surface follows.
    updateActiveTask: true,
    onTaskDeleted: selectNextAfterDelete(deps),
    // Default repo: the cursor task's, else the first listed task's.
    cursorRepo: () => {
      const list = deps.tasks()
      return (list.find((t) => t.id === deps.selectedId()) ?? list[0])?.repo
    },
    // Land the cursor on the new task so Enter / click enters it next.
    selectTask: (id) => deps.setSelectedId(id),
    // Then enter it: `n` lands in the new task's engine pane.
    enterTask: (id) => deps.enterTask(id),
  }
}
