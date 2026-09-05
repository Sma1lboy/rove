/**
 * Dev-section actions. The flows themselves are framework-free
 * (`actions-core.ts`); only the confirm-dialog wiring lives here.
 */

import type { KobeOrchestrator } from "../../../client/remote-orchestrator"
import {
  type DestroyableRenderer,
  destroyRendererSafely,
  hasRestartableDaemon,
  removeTasksFileForReset,
} from "../../../tui/component/settings-dialog/actions-core"
import type { KVContext } from "../../context/kv"
import { t } from "../../i18n"
import type { DialogContext } from "../../ui/dialog"
import { DialogConfirm } from "../../ui/dialog-confirm"

export { hasRestartableDaemon } from "../../../tui/component/settings-dialog/actions-core"

/**
 * Reset is "wipe + relaunch" rather than "wipe + snap defaults in place":
 * kv.clear() only resets the on-disk KV store, not the live UI state the
 * running processes persist on their next change.
 */
export async function confirmResetState(
  dialog: DialogContext,
  kv: KVContext,
  renderer: DestroyableRenderer | null | undefined,
): Promise<void> {
  const ok = await DialogConfirm.show(
    dialog,
    t("settings.reset.title"),
    t("settings.reset.body"),
    "cancel",
    undefined,
    { danger: true },
  )
  if (ok !== true) return
  if (!kv.clear()) {
    await DialogConfirm.show(dialog, t("settings.reset.failedTitle"), t("settings.reset.failedBody"), "cancel")
    return
  }
  removeTasksFileForReset()
  destroyRendererSafely(renderer, "reset")
  process.stderr.write(`${t("settings.reset.done")}\n`)
  process.exit(0)
}

/**
 * Stop this kobe window so a relaunch spawns a fresh daemon from disk,
 * picking up daemon/orchestrator/engine edits.
 */
export async function confirmRestartDaemon(
  dialog: DialogContext,
  orchestrator: KobeOrchestrator | undefined,
  renderer: DestroyableRenderer | null | undefined,
): Promise<void> {
  if (!hasRestartableDaemon(orchestrator)) return
  const ok = await DialogConfirm.show(dialog, t("settings.restart.title"), t("settings.restart.body"), "cancel")
  if (ok !== true) return
  destroyRendererSafely(renderer, "daemon restart")
  process.stderr.write(`${t("settings.restart.done")}\n`)
  process.exit(0)
}
