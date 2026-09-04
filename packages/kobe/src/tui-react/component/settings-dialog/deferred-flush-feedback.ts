import { errorMessage } from "@/lib/error-message"
import { logClientError } from "@sma1lboy/kobe-daemon/client/client-log"
import type { RemoteOrchestrator } from "../../../client/remote-orchestrator"
import { t } from "../../i18n"
import type { DialogContext } from "../../ui/dialog"
import { DialogConfirm } from "../../ui/dialog-confirm"

/** Surface old-daemon/missing-verb failures in the TUI, not only the log. */
export async function flushDeferredPromptsWithFeedback(
  remote: Pick<RemoteOrchestrator, "flushDeferredPrompts">,
  dialog: DialogContext,
): Promise<void> {
  try {
    await remote.flushDeferredPrompts()
  } catch (error) {
    const message = errorMessage(error)
    logClientError("settings", `deferred prompt flush failed: ${message}`)
    await DialogConfirm.show(
      dialog,
      t("settings.deferredFlush.failedTitle"),
      t("settings.deferredFlush.failedBody", { message }),
      "cancel",
    )
  }
}
