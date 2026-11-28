/**
 * Daemon RPC handlers for the local provider gateway.
 *
 * - `gateway.status` returns public status + provider cooldown/stats (NO token, NO API keys).
 * - `gateway.sessionEnv` returns the loopback URL and ephemeral placeholder token
 *   strictly over the owner-only daemon Unix socket for session launches.
 * - `gateway.resetCooldown` clears one or all provider cooldowns.
 * - `gateway.reload` re-reads `providerGateway` config live without restarting the daemon.
 */

import { DEFAULT_PROVIDER_GATEWAY_CONFIG } from "../gateway/config.ts"
import { isGatewayKeychainSupported } from "../gateway/keychain.ts"
import type { ProviderGatewaySessionEnv, ProviderGatewayStatus } from "../gateway/types.ts"
import { optionalString } from "./handler-validators.ts"
import type { DaemonRequestHandler } from "./handlers.ts"

function disabledStatus(): ProviderGatewayStatus {
  return {
    enabled: false,
    running: false,
    host: DEFAULT_PROVIDER_GATEWAY_CONFIG.host,
    port: null,
    baseUrl: null,
    injectMode: DEFAULT_PROVIDER_GATEWAY_CONFIG.injectMode,
    keychainSupported: isGatewayKeychainSupported(),
    providers: [],
  }
}

function disabledSessionEnv(): ProviderGatewaySessionEnv {
  return {
    enabled: false,
    running: false,
    baseUrl: null,
    token: null,
    injectMode: DEFAULT_PROVIDER_GATEWAY_CONFIG.injectMode,
  }
}

export const GATEWAY_HANDLERS: readonly DaemonRequestHandler[] = [
  {
    name: "gateway.status",
    handle(_payload, ctx) {
      return ctx.gateway ? ctx.gateway.status() : disabledStatus()
    },
  },
  {
    name: "gateway.sessionEnv",
    handle(_payload, ctx) {
      return ctx.gateway ? ctx.gateway.sessionEnv() : disabledSessionEnv()
    },
  },
  {
    name: "gateway.resetCooldown",
    handle(payload, ctx) {
      const providerId = optionalString(payload, "providerId")
      const reset = ctx.gateway ? ctx.gateway.resetCooldown(providerId) : 0
      return { reset }
    },
  },
  {
    name: "gateway.reload",
    async handle(_payload, ctx) {
      return ctx.gateway ? await ctx.gateway.reload() : disabledStatus()
    },
  },
]
