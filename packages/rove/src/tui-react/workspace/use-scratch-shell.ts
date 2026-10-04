/**
 * Scratch temp-shell task lifecycle for the host:
 *
 *   - `openScratchShell` (ctrl+e dialog's trailing choice, the only entry; no
 *     chord): a scratch dir task at $HOME whose tab-1 is a bare shell.
 *   - `onScratchExit`: the last shell exited; delete the row, no confirm (it
 *     owns no worktree/branch). Deliberately UNFORCED: `kind: "dir"` already
 *     skips the dirty gate and never removes the directory, so `force` would
 *     only license destroying a real worktree if the row's kind ever changed.
 *   - fold finish (`use-scratch-adopt.ts` moved the sessions under an existing
 *     task): re-point selection to the folded tab ONLY if the scratch row was
 *     selected, then delete the row. Delete AFTER the move, so the daemon's
 *     snapshot pty sweep sees the sessions under a live task id.
 */

import { homedir } from "node:os"
import type { RemoteOrchestrator } from "../../client/remote-orchestrator"
import { userFacingErrorMessage } from "../../lib/error-message"
import { t } from "../../tui/i18n"
import { finishDeletedTaskFlow } from "../../tui/lib/task-actions"
import type { Task } from "../../types/task"
import type { TabsSnapshotKv } from "./terminal-tabs-persist"
import { requestTabActivation } from "./terminal-tabs-shared"
import { useScratchAdopt } from "./use-scratch-adopt"

/** Teardowns already started; module-level to survive per-render rebuilds.
 *  Never cleared (ids stay for the process's life). */
const scratchTeardowns = new Set<string>()

export function useScratchShell(deps: {
  readonly orchestrator: RemoteOrchestrator
  readonly tasks: readonly Task[]
  readonly kv: TabsSnapshotKv
  readonly selectedId: () => string | null
  readonly selectTask: (taskId: string) => void
  readonly enterTask: (taskId: string) => void
  readonly forgetTaskTabs: (taskId: string) => void
  readonly notifyError: (message: string) => void
  readonly notifyInfo: (message: string) => void
}): {
  openScratchShell: () => void
  onScratchExit: (taskId: string) => void
} {
  const { orchestrator, enterTask, forgetTaskTabs, notifyError } = deps

  // The adoption loop rides along; its fold hands back here.
  useScratchAdopt({
    tasks: deps.tasks,
    orchestrator,
    kv: deps.kv,
    notifyInfo: deps.notifyInfo,
    onFold: async (scratchTaskId, targetTaskId, tabId) => {
      // Before the delete, so the deleted-selection fallback never picks a stranger.
      if (deps.selectedId() === scratchTaskId) {
        deps.selectTask(targetTaskId)
        requestTabActivation(targetTaskId, tabId)
      }
      // No `force`: see the header.
      await orchestrator.deleteTask(scratchTaskId)
      forgetTaskTabs(scratchTaskId)
    },
  })

  const openScratchShell = (): void => {
    void orchestrator
      .openDirectoryTask({ dir: homedir(), scratch: true })
      .then((task) => enterTask(task.id))
      .catch((err) => notifyError(t("tasks.toast.scratchOpenFailed", { message: userFacingErrorMessage(err) })))
  }

  const onScratchExit = (taskId: string): void => {
    // Idempotent: ctrl+w on the last tab kills the PTY, whose exit re-enters
    // before the delete lands and would toast a spurious "task not found".
    if (scratchTeardowns.has(taskId)) return
    scratchTeardowns.add(taskId)
    void (async () => {
      try {
        // Unforced: see the header.
        await orchestrator.deleteTask(taskId)
        forgetTaskTabs(taskId)
        await finishDeletedTaskFlow({
          orch: orchestrator,
          tasks: deps.tasks,
          taskId,
          logger: console,
          logPrefix: "[rove scratch]",
          // The exiting shell IS the session you were in; re-point focus.
          updateActiveTask: true,
        })
      } catch (err) {
        notifyError(t("tasks.toast.scratchCloseFailed", { message: userFacingErrorMessage(err) }))
      }
    })()
  }

  return { openScratchShell, onScratchExit }
}
