/**
 * Persistence helpers for `state.json["providerGateway"]` and headless session
 * gateway env lookup.
 *
 * Never stores credentials in `state.json`: `parseProviderGatewayConfig` /
 * `validateProviderInput` refuse plaintext secrets, and live tokens are fetched
 * only in-memory over the owner-only daemon Unix socket.
 */

import { parseProviderGatewayConfig } from "@sma1lboy/rove-daemon/gateway/config"
import type {
  GatewayBindHost,
  GatewayInjectMode,
  GatewayProviderConfig,
  ProviderGatewayConfig,
  ProviderGatewaySessionEnv,
} from "@sma1lboy/rove-daemon/gateway/types"
import { loadStateFile, updateStateFile } from "./store.ts"

export const PROVIDER_GATEWAY_STATE_KEY = "providerGateway"

export interface GatewayEndpointEnv {
  readonly baseUrl: string
  readonly token: string
}

/** Read raw `providerGateway` value from `state.json` (passed to daemon controller). */
export function readRawProviderGatewayConfig(): unknown {
  return loadStateFile()[PROVIDER_GATEWAY_STATE_KEY]
}

/** Read and normalize `providerGateway` from `state.json` (off by default). */
export function loadProviderGatewayConfig(): ProviderGatewayConfig {
  return parseProviderGatewayConfig(readRawProviderGatewayConfig()).config
}

/** Persist a mutated `providerGateway` object under the state-file lock. */
export function updateProviderGatewayConfig(
  mutate: (current: ProviderGatewayConfig) => ProviderGatewayConfig,
): ProviderGatewayConfig {
  let saved: ProviderGatewayConfig = loadProviderGatewayConfig()
  updateStateFile((state) => {
    const current = parseProviderGatewayConfig(state[PROVIDER_GATEWAY_STATE_KEY]).config
    saved = mutate(current)
    state[PROVIDER_GATEWAY_STATE_KEY] = saved
    return undefined
  })
  return saved
}

export function setProviderGatewayEnabled(
  enabled: boolean,
  opts?: { readonly host?: GatewayBindHost; readonly port?: number; readonly injectMode?: GatewayInjectMode },
): ProviderGatewayConfig {
  return updateProviderGatewayConfig((current) => ({
    ...current,
    enabled,
    ...(opts?.host !== undefined ? { host: opts.host } : {}),
    ...(opts?.port !== undefined ? { port: opts.port } : {}),
    ...(opts?.injectMode !== undefined ? { injectMode: opts.injectMode } : {}),
  }))
}

export function upsertGatewayProvider(provider: GatewayProviderConfig): ProviderGatewayConfig {
  return updateProviderGatewayConfig((current) => {
    const next = current.providers.filter((p) => p.id !== provider.id)
    next.push(provider)
    return { ...current, providers: next }
  })
}

export function removeGatewayProvider(id: string): {
  readonly config: ProviderGatewayConfig
  readonly removed: boolean
} {
  let removed = false
  const config = updateProviderGatewayConfig((current) => {
    const next = current.providers.filter((p) => p.id !== id)
    removed = next.length !== current.providers.length
    return { ...current, providers: next }
  })
  return { config, removed }
}

/** Minimal RPC interface shared by `DaemonRpc` and `TabsRpc`. */
export interface GatewayEnvRpc {
  request<T = unknown>(name: string, payload?: unknown): Promise<T>
}

/**
 * Ask the running daemon for the loopback gateway URL and ephemeral placeholder
 * token when the gateway is enabled with `injectMode: "headless"`.
 *
 * Short-circuits before touching the socket whenever `providerGateway.enabled`
 * is false (the default), so disabled setups and interactive BYOS sessions pay
 * zero cost and see no env changes.
 */
export async function fetchHeadlessGatewayEnv(client: GatewayEnvRpc): Promise<GatewayEndpointEnv | undefined> {
  const cfg = loadProviderGatewayConfig()
  if (!cfg.enabled || cfg.injectMode !== "headless") return undefined
  try {
    const res = await client.request<ProviderGatewaySessionEnv>("gateway.sessionEnv", {})
    if (!res?.running || res.injectMode !== "headless" || !res.baseUrl || !res.token) return undefined
    return { baseUrl: res.baseUrl, token: res.token }
  } catch {
    // Older daemon or unreachable RPC: leave the session's environment untouched.
    return undefined
  }
}
