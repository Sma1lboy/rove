/**
 * Types for the opt-in local loopback provider gateway (`rove-daemon`).
 *
 * Security invariants carried by these shapes:
 * - No type here ever holds a raw upstream API key in persisted config or
 *   status snapshots; keys live in the OS keychain (or an env var fallback on
 *   platforms without keychain wiring) and are resolved only at request time.
 * - Bind host is strictly loopback (`127.0.0.1` or `::1`).
 */

export type GatewayProviderProtocol = "anthropic" | "openai"

export type GatewayInjectMode = "headless" | "off"

export type GatewayKeySource = "keychain" | "env" | "none"

export type GatewayBindHost = "127.0.0.1" | "::1"

export interface GatewayProviderConfig {
  readonly id: string
  readonly protocol: GatewayProviderProtocol
  readonly baseUrl: string
  /** Lower number = higher priority; ties break by config order. */
  readonly priority: number
  /** Exact model ids, `prefix*` globs, or `*`. */
  readonly models: readonly string[]
  /** Optional requested-model -> upstream-model rewrite. */
  readonly modelMap?: Readonly<Record<string, string>>
  /** Keychain account name; defaults to `provider:<id>`. */
  readonly keychainAccount?: string
  /** Fallback environment variable name when keychain is unavailable or empty. */
  readonly apiKeyEnv?: string
  readonly enabled: boolean
  /** Non-secret upstream headers (authorization / x-api-key are rejected). */
  readonly extraHeaders?: Readonly<Record<string, string>>
}

export interface ProviderGatewayConfig {
  readonly enabled: boolean
  readonly host: GatewayBindHost
  /** `0` picks an ephemeral loopback port on startup. */
  readonly port: number
  /** `headless` injects loopback env into API/routine sessions; `off` leaves all launches untouched. */
  readonly injectMode: GatewayInjectMode
  readonly cooldownMs: number
  readonly maxCooldownMs: number
  readonly requestTimeoutMs: number
  readonly providers: readonly GatewayProviderConfig[]
}

export interface GatewayProviderRuntimeStatus {
  readonly id: string
  readonly protocol: GatewayProviderProtocol
  readonly baseUrl: string
  readonly priority: number
  readonly models: readonly string[]
  readonly enabled: boolean
  readonly keySource: GatewayKeySource
  readonly apiKeyEnv: string
  readonly inCooldown: boolean
  readonly cooldownUntil: string | null
  readonly consecutiveFailures: number
  readonly lastStatus: number | null
  readonly lastError: string | null
  readonly lastSuccessAt: string | null
  readonly requests: number
  readonly failovers: number
}

export interface ProviderGatewayStatus {
  readonly enabled: boolean
  readonly running: boolean
  readonly host: GatewayBindHost
  readonly port: number | null
  readonly baseUrl: string | null
  readonly injectMode: GatewayInjectMode
  readonly keychainSupported: boolean
  readonly providers: readonly GatewayProviderRuntimeStatus[]
}

export interface ProviderGatewaySessionEnv {
  readonly enabled: boolean
  readonly running: boolean
  readonly baseUrl: string | null
  readonly token: string | null
  readonly injectMode: GatewayInjectMode
}

export interface GatewayLogEvent {
  readonly event: "started" | "stopped" | "auth_failed" | "request" | "failover" | "cooldown" | "exhausted"
  readonly ts: string
  readonly requestId?: string
  readonly inboundProtocol?: GatewayProviderProtocol
  readonly model?: string
  readonly providerId?: string
  readonly upstreamProtocol?: GatewayProviderProtocol
  readonly upstreamModel?: string
  readonly status?: number
  readonly latencyMs?: number
  readonly attempt?: number
  readonly cooldownMs?: number
  readonly reason?: string
}
