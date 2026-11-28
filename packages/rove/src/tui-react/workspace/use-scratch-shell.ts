/**
 * Opening a No folder session (ctrl+e dialog's "scratch" destination, the only entry; no chord):
 * an Ungrouped dir task at $HOME whose tab-1 runs the picked engine, or a bare shell when none was
 * picked. It then lives like any other session; only an explicit move takes it out of Ungrouped.
 */

import { homedir } from "node:os"
import type { RemoteOrchestrator } from "@sma1lboy/rove-client/client/remote-orchestrator.ts"
import { t } from "@sma1lboy/rove-core/i18n/index.ts"
import { userFacingErrorMessage } from "@sma1lboy/rove-core/lib/error-message.ts"
import { deriveTitleFromPrompt } from "@sma1lboy/rove-core/orchestrator/title.ts"
import { getGlobalDefaultVendor } from "@sma1lboy/rove-core/state/vendor-prefs.ts"
import { DEFAULT_TASK_VENDOR } from "@sma1lboy/rove-core/types/task.ts"
import type { VendorId } from "@sma1lboy/rove-core/types/vendor.ts"
import { defaultDaemonLogPath } from "@sma1lboy/rove-daemon/daemon/paths"
import { shellScratchTasks } from "./terminal-tabs-shared"

/** The model and effort a No folder session launches its engine with. */
export type ScratchModelPick = { readonly model?: string; readonly modelEffort?: string }

export function useScratchShell(deps: {
  readonly orchestrator: RemoteOrchestrator
  readonly enterTask: (taskId: string) => void
  readonly notifyError: (message: string) => void
  /** Parks a first prompt that the task's engine tab starts on. */
  readonly seedPrompt: (taskId: string, prompt: string) => void
}): {
  openScratchShell: (vendor: VendorId | undefined, prompt?: string, pick?: ScratchModelPick) => void
  reportProblem: () => void
} {
  const { orchestrator, enterTask, notifyError } = deps

  const openScratchShell = (vendor: VendorId | undefined, prompt?: string, pick?: ScratchModelPick): void => {
    void orchestrator
      .openDirectoryTask({
        dir: homedir(),
        noProject: true,
        ...(vendor ? { vendor, ...pick } : {}),
        // Engines without a readable transcript never get auto-titled, so name it from the prompt now.
        ...(prompt?.trim() ? { title: deriveTitleFromPrompt(prompt) } : {}),
      })
      .then((task) => {
        // Before the select mounts its tabs: the mount reads the mark.
        if (!vendor) shellScratchTasks.add(task.id)
        if (vendor && prompt) deps.seedPrompt(task.id, prompt)
        enterTask(task.id)
      })
      .catch((err) => notifyError(t("tasks.toast.scratchOpenFailed", { message: userFacingErrorMessage(err) })))
  }

  /** Report a problem: a No folder conversation on the default engine, seeded to interview the user and file the issue. */
  const reportProblem = (): void =>
    openScratchShell(
      getGlobalDefaultVendor() ?? DEFAULT_TASK_VENDOR,
      t("help.reportPrompt", { logPath: defaultDaemonLogPath() }),
    )

  return { openScratchShell, reportProblem }
}
