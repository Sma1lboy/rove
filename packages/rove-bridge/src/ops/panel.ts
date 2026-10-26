/**
 * The Browser panel's pre-flight: can this page be framed? One HTTPS HEAD, through the same
 * narrow probe `rove api panel-show` uses (`rove-daemon/src/daemon/frame-check.ts`): private
 * addresses refused, no redirect followed, 3 seconds.
 */

import { checkFrame } from "@sma1lboy/rove-daemon/daemon/frame-check"
import { BridgeError } from "../protocol.ts"
import type { OpTable } from "./types.ts"

const URL_MAX = 2048

export const panelOps: OpTable = {
  "browser.probe": {
    kind: "read",
    destructive: false,
    wraps: "frame probe (HTTPS HEAD to a public address; reads X-Frame-Options and CSP frame-ancestors)",
    async run(a) {
      const { url, origin } = a
      if (typeof url !== "string" || url.length === 0 || url.length > URL_MAX) {
        throw new BridgeError("BAD_ARGS", "url must be a URL string")
      }
      if (origin !== undefined && (typeof origin !== "string" || origin.length > URL_MAX)) {
        throw new BridgeError("BAD_ARGS", "origin must be the page's origin string")
      }
      return checkFrame(url, origin === undefined ? {} : { origin })
    },
  },
}
