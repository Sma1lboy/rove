import { userFacingErrorMessage } from "@/lib/error-message"
import { t } from "../../tui/i18n"

export type InboxRpcAction = "mark read" | "dismiss"

/**
 * The action is a KEY, not an interpolated English verb. Splicing "mark read"
 * or "dismiss" into a sentence produces a half-translated toast in every
 * locale but English, and the two failures also survive differently phrased —
 * so each gets its own string.
 */
const FAILURE_KEY: Record<InboxRpcAction, string> = {
  "mark read": "tasks.toast.inboxMarkReadFailed",
  dismiss: "tasks.toast.inboxDismissFailed",
}

export function notifyInboxRpcFailure(
  request: Promise<unknown>,
  action: InboxRpcAction,
  notifyError: (message: string) => void,
): void {
  void request.catch((err) => notifyError(t(FAILURE_KEY[action], { error: userFacingErrorMessage(err) })))
}
