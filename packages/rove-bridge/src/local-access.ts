/**
 * This computer's own browser gets in without the link or a password, unless `requireToken` is set in
 * `bridge/config.json`. Only a plain local run offers it (no preset, no `--public-host`, loopback listeners),
 * and only to a request that came straight from this computer: anything a tunnel or proxy forwarded
 * still presents a token.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import type { BridgeArgs } from "./cli-args.ts"
import { BridgeError } from "./protocol.ts"

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

export interface LocalAccess {
  /** No credential is asked of this computer's own browser. */
  open(): boolean
  /** Writes `requireToken`; with `on`, returns a device token for the browser that asked, so it stays in. */
  setRequireToken(on: boolean): string | null
}

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

function readRaw(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {}
  try {
    const raw: unknown = JSON.parse(readFileSync(path, "utf8"))
    return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  } catch {
    // A config that no longer parses must not open the door: the caller reads this as "ask for the token".
    return { requireToken: true }
  }
}

export function createLocalAccess(configPath: string, mintDevice: () => string): LocalAccess {
  return {
    // Read per connection: a change in Settings or by hand applies without a restart.
    open: () => readRaw(configPath).requireToken !== true,
    setRequireToken(on) {
      const { requireToken: _old, ...rest } = readRaw(configPath)
      mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 })
      writeFileSync(configPath, `${JSON.stringify(on ? { ...rest, requireToken: true } : rest, null, 2)}\n`, {
        mode: 0o600,
      })
      return on ? mintDevice() : null
    },
  }
}

/** `auth.status` and `auth.requireToken {on}`. Only a browser that got in without a token is handed one to stay in. */
export function authOp(
  local: LocalAccess | undefined,
  op: "auth.status" | "auth.requireToken",
  args: Readonly<Record<string, unknown>>,
  credential: string,
): { canChange: boolean; requireToken: boolean } | { token?: string } {
  if (op === "auth.status") return { canChange: local !== undefined, requireToken: local?.open() === false }
  if (!local) throw new BridgeError("UNSUPPORTED", "a bridge reachable from elsewhere always asks for a token")
  if (typeof args.on !== "boolean") throw new BridgeError("BAD_ARGS", "on must be a boolean")
  const token = local.setRequireToken(args.on)
  return credential === LOCAL_CREDENTIAL && token ? { token } : {}
}
