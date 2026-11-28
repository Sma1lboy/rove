/** The relay side of a bridge run: the agent and its loopback ingress, the saved relay, a paired phone's name. */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { hostname as osHostname } from "node:os"
import { dirname, join } from "node:path"
import { RelayAgent } from "@hsinsekai-nanami/agent"
import { loadOrCreateToken } from "./auth.ts"
import { type BridgeDeps, startBridgeServer } from "./server.ts"
import { loginDeviceName } from "./web-login.ts"

/**
 * `--preset relay`: a second loopback listener that only the relay agent dials. The agent opens its
 * sockets with no headers, so this one listener takes the token from `?token=`; the bearer token
 * is still required, the relay's E2E layer is on top of it.
 */
export function startRelay(
  deps: BridgeDeps,
  server: string,
  bridgeDir: string,
  rotate: boolean,
): { code: string; server: string } {
  // Same shape as relay-kit's generateCode (32 random bytes, base64url), owner-only like the token.
  const code = loadOrCreateToken(join(bridgeDir, "relay-code"), rotate)
  // Shares `deps.login` (and its lockout): under this preset it already trusts no forwarded IP.
  const ingress = startBridgeServer(relayIngressDeps(deps), { hostname: "127.0.0.1", port: 0 })
  const agent = new RelayAgent({ serverUrl: server, code, localPort: ingress.port ?? 0, deviceName: osHostname() })
  agent.start()
  return { code, server }
}

/**
 * The relay agent dials this listener from loopback with no forwarded headers, so every relayed browser would look
 * like this computer's own: its sockets never get the `open` sign-in mode's tokenless pass, even when the main
 * listener (a plain local run that started the relay from Settings) does.
 */
export function relayIngressDeps(deps: BridgeDeps): BridgeDeps {
  return {
    ...deps,
    tokenInQuery: true,
    ...(deps.signIn ? { signIn: { ...deps.signIn, opens: () => false } } : {}),
  }
}

/** Remembered in `config.json`, so the next start dials the relay a paired phone uses. */
export function saveRelayServer(configPath: string, server: string): void {
  const raw: unknown = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : {}
  const rest = raw && typeof raw === "object" ? raw : {}
  mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 })
  writeFileSync(configPath, `${JSON.stringify({ ...rest, relayServer: server }, null, 2)}\n`, { mode: 0o600 })
}

export function phoneDeviceName(devicesPath: string, now: Date): string {
  return loginDeviceName(devicesPath, now, "phone")
}
