/**
 * `CreateTaskContext` wiring shared by both task-action hosts (workspace and
 * Tasks pane), one copy so they can't drift. Pure wiring: behavior lives in
 * `tui/lib/task-actions` + `tui/lib/task-create-flow`.
 */

import type { RemoteOrchestrator } from "../../client/remote-orchestrator.ts"
import { isDeleteBranchOnTaskDeleteEnabled } from "../../state/task-delete-branch.ts"
import { resolvePreferredVendor, setLastActiveVendor } from "../../state/vendor-prefs.ts"
import { openTaskEngine } from "../../tui/lib/open-task-engine"
import type { ChildrenPrompt, ConfirmPrompt, TextPromptOpts } from "../../tui/lib/task-actions"
import type { CreateTaskContext } from "../../tui/lib/task-create-flow"
import type { Task, VendorId } from "../../types/task.ts"
import { RenameTaskDialog } from "../component/rename-task-dialog"
import type { DialogContext } from "./dialog"
import { DialogChoice } from "./dialog-choice"
import { DialogConfirm } from "./dialog-confirm"

/** The dialog-surfacing callbacks of `TaskActionContext`. */
function taskDialogAdapters(dialog: DialogContext): {
  confirm: (p: ConfirmPrompt) => Promise<boolean>
  pickChildren: (p: ChildrenPrompt) => Promise<"promote" | "cascade" | undefined>
  promptText: (initial: string, opts?: TextPromptOpts) => Promise<string | undefined>
} {
  return {
    confirm: async (p) =>
      (await DialogConfirm.show(dialog, p.title, p.body, p.cancelLabel, p.confirmLabel, { danger: p.danger })) === true,
    // Promote (focused), Delete with children, Cancel; esc aborts too.
    pickChildren: (p) =>
      DialogChoice.show<"promote" | "cascade">(dialog, {
        title: p.title,
        message: p.body,
        options: [
          { value: "promote", label: p.promoteLabel },
          { value: "cascade", label: p.cascadeLabel, danger: true },
          { value: undefined, label: p.cancelLabel },
        ],
        initial: 0,
      }),
    promptText: (initial, opts) => RenameTaskDialog.show(dialog, initial, opts),
  }
}

/** The vendor preference pair (state/vendor-prefs.ts). */
const vendorPrefAdapters = {
  lastVendor: (): VendorId | undefined => resolvePreferredVendor(),
  rememberVendor: (vendor: VendorId): void => setLastActiveVendor(vendor),
} as const

/** Deps for {@link buildBaseCreateTaskContext} — the wiring both hosts already own. */
export interface BaseCreateTaskContextDeps {
  readonly orch: RemoteOrchestrator | null
  readonly tasks: () => readonly Task[]
  readonly dialog: DialogContext
  /** The host's New task page: resolves with the form's answer, `undefined` on cancel. */
  readonly promptNewTask: CreateTaskContext["promptNewTask"]
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
    promptNewTask: deps.promptNewTask,
    ...vendorPrefAdapters,
    logger: console,
    logPrefix: deps.logPrefix,
    notifyError: deps.notifyError,
    notifyInfo: deps.notifyInfo,
    // Publish the shared active-task focus so every surface follows.
    updateActiveTask: true,
    deleteBranchOnDelete: isDeleteBranchOnTaskDeleteEnabled,
    // Land the cursor on the new task so Enter / click enters it next.
    selectTask: (id) => deps.setSelectedId(id),
    // Then enter it: `n` lands in the new task's engine pane.
    enterTask: (id) => deps.enterTask(id),
    // A daemon runs the engine; with no daemon there is no task to start it in.
    ...(deps.orch ? { openEngine: openTaskEngine } : {}),
  }
}
