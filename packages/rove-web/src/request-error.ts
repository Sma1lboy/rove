import { BridgeRequestError } from "./bridge.ts"
import { t } from "./i18n/index.ts"

/** The line a failed request shows. A dropped socket is not the view's fault and
 *  is worded in the reader's language; anything else keeps the daemon's or
 *  git's own message. Call it inside a request handler, never at module level. */
export function requestErrorText(err: unknown): string {
  if (err instanceof BridgeRequestError && err.code === "NOT_CONNECTED") return t("workspace.connect.notConnected")
  return err instanceof Error ? err.message : String(err)
}
