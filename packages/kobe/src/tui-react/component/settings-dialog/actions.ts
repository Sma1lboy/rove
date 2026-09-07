/**
 * Dev-section actions. The flows themselves are framework-free
 * (`actions-core.ts`); only the confirm-dialog wiring lives here.
 */

import { relaunchSelf } from "../../../cli/self-relaunch"
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
 * Restart the backend from inside Rove: stop the daemon, then relaunch this
 * process on the build that is on disk.
 *
 * It used to do only the first half of its own name — destroy the renderer and
 * `process.exit(0)`, leaving the user at a shell prompt to type `rove` again,
 * which is a quit with an explanation rather than a restart. Both halves have
 * to reload from disk for the dev loop this row exists for (edit daemon code,
 * see it run) to close, and only a relaunch can reload this half. Engine
 * sessions are untouched either way: they belong to the separate PTY host,
 * which outlives both processes.
 */
export async function confirmRestartDaemon(
  dialog: DialogContext,
  orchestrator: KobeOrchestrator | undefined,
  renderer: DestroyableRenderer | null | undefined,
): Promise<void> {
  if (!hasRestartableDaemon(orchestrator)) return
  const ok = await DialogConfirm.show(dialog, t("settings.restart.title"), t("settings.restart.body"), "cancel")
  if (ok !== true) return
  // Stop the daemon BEFORE the relaunch, never after — this process is about
  // to stop existing, so anything queued to happen "later" simply does not.
  // `restart` is what the outgoing daemon tells every OTHER attached window,
  // so their reconnect loops learn the code is being swapped rather than that
  // the daemon is done. Best-effort: a daemon already gone or too wedged to
  // answer leaves nothing to stop, and the successor spawns one on its first
  // connect regardless.
  await orchestrator.restartDaemon()
  relaunchSelf({ renderer, notice: t("settings.restart.done") })
}
