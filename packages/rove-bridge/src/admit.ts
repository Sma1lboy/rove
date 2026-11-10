/** Who a WebSocket upgrade is: the shared token, a device, this computer's own browser, or nobody. */

import { browserOriginAllowed, presentedToken, tokenMatches } from "./auth.ts"
import { LOCAL_CREDENTIAL } from "./local-access.ts"
import { type Credential, sharedCredential } from "./push.ts"
import type { BridgeDeps } from "./server.ts"

export interface Admitted {
  /** For the audit line: a device's name, `shared-token` or `this-computer`. */
  readonly name: string
  readonly credential: Credential
}

/** The connection's identity, or the response that refuses it. `local`: the request may come in without a token. */
export function admit(
  req: Request,
  at: { readonly local: boolean; readonly from: string; readonly log: (line: string) => void },
  deps: Pick<BridgeDeps, "token" | "deviceOf" | "publicHost" | "tokenInQuery">,
): Admitted | Response {
  // Phones send no Origin. A browser always does; one from another site never gets a socket,
  // even holding the token. Absent Origin still needs the token below.
  const origin = req.headers.get("origin")
  if (origin !== null && !browserOriginAllowed(origin, req.headers.get("host"), deps.publicHost ?? null)) {
    at.log(`[rove-bridge] 403 from ${at.from}: cross-origin upgrade from ${origin}`)
    return new Response("forbidden\n", { status: 403 })
  }
  const presented = presentedToken(req, deps.tokenInQuery === true)
  if (tokenMatches(deps.token, presented)) return { name: "shared-token", credential: sharedCredential(deps.token) }
  const device = deps.deviceOf?.(presented)
  if (device) {
    at.log(`[rove-bridge] ${new Date().toISOString()} device ${device} connected from ${at.from}`)
    return { name: device, credential: device }
  }
  if (at.local) return { name: "this-computer", credential: LOCAL_CREDENTIAL }
  at.log(`[rove-bridge] 401 from ${at.from}: missing or wrong bearer token`)
  return new Response("unauthorized\n", { status: 401 })
}
