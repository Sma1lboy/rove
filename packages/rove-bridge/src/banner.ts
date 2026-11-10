/** What a bridge start prints: where it listens, and the links to open or pair with. */

import { join } from "node:path"
import { CURRENT_VERSION } from "@sma1lboy/rove/src/version.ts"
import { renderUnicodeCompact } from "uqr"
import { pairingUrl, relayLink, webUrl } from "./auth.ts"
import type { BridgeArgs } from "./cli-args.ts"
import type { SignInMode } from "./sign-in.ts"

export function printBanner(o: {
  readonly name: string
  /** `rove --web`: the browser client is served too. */
  readonly web: boolean
  readonly home: string
  readonly bridgeDir: string
  readonly args: BridgeArgs
  readonly token: string
  readonly servers: readonly { readonly hostname?: string; readonly port?: number }[]
  /** The sign-in mode (`sign-in.ts`); null when no browser client is served. */
  readonly signIn: SignInMode | null
  readonly relayCode: string | null
}): void {
  console.log(`${o.name} ${CURRENT_VERSION} — Rove home ${o.home}`)
  for (const server of o.servers) {
    const host = server.hostname ?? "127.0.0.1"
    const port = server.port ?? o.args.port
    console.log(`listening on ${host}:${port}${o.args.preset === "none" ? "" : ` (preset ${o.args.preset})`}`)
    if (host === "0.0.0.0" || host === "::") {
      console.log("  WARNING: all interfaces, plain ws:// — prefer --preset tailscale or --preset cf")
    }
    const publicHost = o.args.publicHost ?? host
    const link = webUrl({ host: publicHost, port, token: o.token, tls: o.args.tls })
    const bare = link.split("#")[0]
    if (o.signIn === "open") {
      console.log(`\nopen: ${bare}`)
      console.log(
        `  No sign-in on this computer. For a password or the token link, set "auth" to "password" or "token" in ${join(o.bridgeDir, "config.json")}, or pick one in Settings.`,
      )
    } else if (o.web) console.log(`\nopen: ${link}`)
    if (o.signIn === "password") console.log(`password login: on at ${bare}`)
    if (o.relayCode !== null) continue
    const url = pairingUrl({ host: publicHost, port, token: o.token, tls: o.args.tls, preset: o.args.preset })
    console.log(`${o.web ? "" : "\n"}pair: ${url}`)
    if (o.args.qr && !o.web) console.log(renderUnicodeCompact(url))
  }
  if (o.relayCode !== null && o.args.relayServer) {
    const link = relayLink({ server: o.args.relayServer, code: o.relayCode, token: o.token })
    console.log(`\nrelay (end-to-end encrypted through ${o.args.relayServer}):\n${link}`)
    if (o.args.qr) console.log(renderUnicodeCompact(link))
    console.log("`--rotate-relay` unpairs every browser paired through the relay.")
  }
  if (o.args.cloudflare) {
    console.log(
      `\nCloudflare Access: team ${o.args.cloudflare.teamDomain}, every connection needs a valid JWT for this AUD.`,
    )
    console.log(`Point the tunnel at http://127.0.0.1:${o.args.port} (e.g. ingress service for ${o.args.publicHost}).`)
  }
  console.log(
    `\nThe ${o.web ? "links are passwords" : "pairing URL is a password"}. \`--rotate-token\` revokes every paired phone${o.web ? " and browser" : ""}.`,
  )
}
