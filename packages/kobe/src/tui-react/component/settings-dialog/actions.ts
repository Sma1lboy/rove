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

/**
 * Install (or refresh) Rove's activity hooks in every engine's own config —
 * the Engines section's one install action.
 *
 * It calls the SAME `ensureGlobalKobeHooks` the TUI already runs once per
 * launch, rather than a settings-only reimplementation: that function owns
 * the plugin-takeover skip, the volume gate on the tool-event family and the
 * retired-hook cleanups, and a second installer would have drifted from it
 * the first time any of those changed.
 *
 * Imported dynamically for the reason `engine/hook-config-check.ts` gives:
 * a static edge from a render path to a CLI verb's module lands as a
 * bundle-only TDZ crash in a neighbouring verb. Best-effort — the callee
 * swallows its own failures and the panel's re-probe is what reports the
 * result, by showing the states that did not change.
 */
export async function installEngineHooks(): Promise<void> {
  try {
    const { ensureGlobalKobeHooks } = await import("../../../cli/hook-cmd")
    // `quiet`: at launch a refusal prints to stderr, which is where `rove
    // doctor` sends a reader whose hook channel is dead. Fired from here it
    // would be a raw write underneath a live OpenTUI render — it paints over
    // the frame — and the panel puts the same refusal on the engine's own row
    // anyway, which is the whole reason that row exists.
    await ensureGlobalKobeHooks({ quiet: true })
  } catch {
    /* never let a settings keypress throw through the render path */
  }
}

/**
 * Remove Rove's activity hooks from every engine config that has them — the
 * other half of the install action.
 *
 * Per-adapter rather than one sweep: each adapter knows its own file shape
 * and leaves a third party's entries in the same document alone, which a
 * delete-the-file approach would not. `removeActivityHooks` is idempotent by
 * contract, so an engine that was never hooked costs a stat.
 *
 * Each engine is caught on its own: one unwritable config must not abandon
 * the engines after it in the list. The panel's re-probe is what reports the
 * result, by showing the states that did not change.
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
