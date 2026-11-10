/**
 * Which runs and which requests the `open` sign-in mode (`sign-in.ts`) covers: only a plain local run
 * (no preset, no `--public-host`, loopback listeners), and only a request that came straight from this
 * computer. Anything a tunnel or proxy forwarded still presents a token.
 */

import type { BridgeArgs } from "./cli-args.ts"

/** What a connection let in this way holds in place of a device name. */
export const LOCAL_CREDENTIAL = "local"

const LOOPBACK_ADDRESS = /^(127\.|::1$|::ffff:127\.)/
const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i
/** Set by cloudflared, `tailscale serve` and reverse proxies: the real client is somewhere else. */
const FORWARDED = [
  "cf-connecting-ip",
  "forwarded",
  "via",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-real-ip",
]

/** A bridge only this computer can reach as started: every other way in keeps asking for a token. */
export function plainLocalRun(args: Pick<BridgeArgs, "preset" | "hosts" | "publicHost" | "relayServer">): boolean {
  return (
    args.preset === "none" &&
    args.publicHost === null &&
    args.relayServer === null &&
    args.hosts.every((host) => LOOPBACK_HOST.test(host.includes(":") && !host.startsWith("[") ? `[${host}]` : host))
  )
}

/** The request was typed into a browser on this computer: a loopback peer, a loopback Host, nothing forwarded. */
export function directFromThisComputer(req: Request, peer: string | undefined): boolean {
  if (!peer || !LOOPBACK_ADDRESS.test(peer)) return false
  if (!LOOPBACK_HOST.test(req.headers.get("host") ?? "")) return false
  return FORWARDED.every((name) => !req.headers.has(name))
}
