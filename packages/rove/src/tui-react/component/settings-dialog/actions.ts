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
 * Stop the daemon, then relaunch this process on the on-disk build: both
 * halves must reload for the edit-daemon-code-see-it-run loop. Engine sessions
 * are untouched; they belong to the PTY host, which outlives both processes.
 */
export async function confirmRestartDaemon(
  dialog: DialogContext,
  orchestrator: KobeOrchestrator | undefined,
  renderer: DestroyableRenderer | null | undefined,
): Promise<void> {
  if (!hasRestartableDaemon(orchestrator)) return
  const ok = await DialogConfirm.show(dialog, t("settings.restart.title"), t("settings.restart.body"), "cancel")
  if (ok !== true) return
  // Stop BEFORE the relaunch: this process is about to exit, so nothing queued
  // "later" runs. `restart` tells every OTHER attached window the code is being
  // swapped, not that the daemon is done. Best-effort: a gone or wedged daemon
  // leaves nothing to stop, and the successor spawns one on first connect.
  await orchestrator.restartDaemon()
  relaunchSelf({ renderer, notice: t("settings.restart.done") })
}

/**
 * Install (or refresh) Rove's activity hooks in every engine's config.
 *
 * Reuses the launch-time `ensureGlobalKobeHooks`, which owns the
 * plugin-takeover skip, the tool-event volume gate and retired-hook cleanups;
 * a second installer would drift. Imported dynamically: a static edge from a
 * render path to a CLI verb's module is a bundle-only TDZ crash (see
 * `engine/hook-config-check.ts`). Best-effort; the panel's re-probe reports
 * the result.
 */
export async function installEngineHooks(): Promise<void> {
  try {
    const { ensureGlobalKobeHooks } = await import("../../../cli/hook-cmd")
    // `quiet`: a stderr write under a live OpenTUI render paints over the
    // frame, and the panel already shows the refusal on the engine's row.
    await ensureGlobalKobeHooks({ quiet: true })
  } catch {
    /* never let a settings keypress throw through the render path */
  }
}

/**
 * Remove Rove's activity hooks from every engine config that has them.
 *
 * Per-adapter so third-party entries in the same file survive;
 * `removeActivityHooks` is idempotent, so an unhooked engine costs a stat.
 * Each engine is caught on its own so one unwritable config doesn't abandon
 * the rest. The panel's re-probe reports the result.
 */
export async function uninstallEngineHooks(): Promise<void> {
  try {
    const { activityHookAdapters } = await import("../../../engine/hook-adapter")
    await Promise.all(
      activityHookAdapters().map(async (adapter) => {
        try {
          await adapter.removeActivityHooks(adapter.globalSettingsPath())
        } catch {
          /* unwritable or absent config — the panel re-probe shows it stayed */
        }
      }),
    )
  } catch {
    /* never let a settings keypress throw through the render path */
  }
}
