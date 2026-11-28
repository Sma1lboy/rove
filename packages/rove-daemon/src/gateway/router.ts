/**
 * Priority routing, model matching, cooldown tracking, and structured logging
 * for the local provider gateway.
 */

import { type GatewayCredentialDeps, describeProviderKeySource, effectiveProviderKeyEnv } from "./keychain.ts"
import type {
  GatewayLogEvent,
  GatewayProviderConfig,
  GatewayProviderRuntimeStatus,
  ProviderGatewayConfig,
} from "./types.ts"

interface ProviderStats {
  cooldownUntilMs: number
  consecutiveFailures: number
  lastStatus: number | null
  lastError: string | null
  lastSuccessAt: string | null
  requests: number
  failovers: number
}

/**
 * Redact anything shaped like a bearer token or API key before writing error
 * text into structured logs or runtime status.
 */
export function scrubSecretText(text: string): string {
  return text
    .replace(/(bearer\s+)[A-Za-z0-9._\-+/=]{8,}/gi, "$1[REDACTED]")
    .replace(/\b(sk-[A-Za-z0-9_-]{8,}|rove-gw-[A-Za-z0-9_-]{8,})\b/g, "[REDACTED]")
}

/**
 * Match a requested model against a provider pattern: exact, trailing `*`
 * prefix glob (e.g. `foo-*`), or bare `*`.
 */
export function matchModelPattern(pattern: string, model: string): boolean {
  if (pattern === "*") return true
  if (pattern.endsWith("*")) return model.startsWith(pattern.slice(0, -1))
  return pattern === model
}

export function providerOffersModel(provider: GatewayProviderConfig, model: string): boolean {
  return provider.models.some((pattern) => matchModelPattern(pattern, model))
}

export function resolveUpstreamModel(provider: GatewayProviderConfig, requestedModel: string): string {
  return provider.modelMap?.[requestedModel] ?? requestedModel
}

/** True for HTTP statuses that warrant cooling down the provider and failing over. */
export function isFailoverStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599)
}

/** Parse HTTP `Retry-After` (delta seconds or HTTP-date) into ms, or null if absent/invalid. */
export function parseRetryAfterMs(headerValue: string | null | undefined, nowMs: number): number | null {
  if (!headerValue) return null
  const trimmed = headerValue.trim()
  if (!trimmed) return null
  if (/^\d+$/.test(trimmed)) {
    const secs = Number.parseInt(trimmed, 10)
    return Number.isFinite(secs) && secs > 0 ? secs * 1000 : null
  }
  const dateMs = Date.parse(trimmed)
  if (!Number.isFinite(dateMs)) return null
  const delta = dateMs - nowMs
  return delta > 0 ? delta : null
}

export interface ProviderRouterOptions {
  readonly now?: () => number
  readonly onLog?: (event: GatewayLogEvent) => void
  readonly credentialDeps?: GatewayCredentialDeps
}

export class ProviderGatewayRouter {
  private config: ProviderGatewayConfig
  private readonly stats = new Map<string, ProviderStats>()
  private readonly now: () => number
  private readonly onLog: ((event: GatewayLogEvent) => void) | undefined
  private readonly credentialDeps: GatewayCredentialDeps | undefined

  constructor(config: ProviderGatewayConfig, options: ProviderRouterOptions = {}) {
    this.config = config
    this.now = options.now ?? (() => Date.now())
    this.onLog = options.onLog
    this.credentialDeps = options.credentialDeps
  }

  getConfig(): ProviderGatewayConfig {
    return this.config
  }

  updateConfig(config: ProviderGatewayConfig): void {
    this.config = config
    const liveIds = new Set(config.providers.map((p) => p.id))
    for (const id of this.stats.keys()) {
      if (!liveIds.has(id)) this.stats.delete(id)
    }
  }

  emitLog(event: Omit<GatewayLogEvent, "ts">): void {
    const entry: GatewayLogEvent = {
      ...event,
      ts: new Date(this.now()).toISOString(),
      ...(event.reason ? { reason: scrubSecretText(event.reason) } : {}),
    }
    this.onLog?.(entry)
  }

  private statsFor(providerId: string): ProviderStats {
    let existing = this.stats.get(providerId)
    if (!existing) {
      existing = {
        cooldownUntilMs: 0,
        consecutiveFailures: 0,
        lastStatus: null,
        lastError: null,
        lastSuccessAt: null,
        requests: 0,
        failovers: 0,
      }
      this.stats.set(providerId, existing)
    }
    return existing
  }

  /**
   * Ordered candidate providers for `model`: enabled, offering `model`, sorted
   * by ascending `priority` (config order breaks ties). Splits into ready
   * candidates vs those currently in cooldown.
   */
  selectCandidates(model: string): {
    readonly ready: readonly GatewayProviderConfig[]
    readonly cooling: readonly { readonly provider: GatewayProviderConfig; readonly retryAfterMs: number }[]
  } {
    const nowMs = this.now()
    const matching = this.config.providers
      .map((provider, index) => ({ provider, index }))
      .filter(({ provider }) => provider.enabled && providerOffersModel(provider, model))
      .sort((a, b) => a.provider.priority - b.provider.priority || a.index - b.index)

    const ready: GatewayProviderConfig[] = []
    const cooling: { provider: GatewayProviderConfig; retryAfterMs: number }[] = []

    for (const { provider } of matching) {
      const s = this.stats.get(provider.id)
      if (s && s.cooldownUntilMs > nowMs) {
        cooling.push({ provider, retryAfterMs: s.cooldownUntilMs - nowMs })
      } else {
        ready.push(provider)
      }
    }
    return { ready, cooling }
  }

  recordSuccess(providerId: string, status: number): void {
    const s = this.statsFor(providerId)
    s.requests++
    s.consecutiveFailures = 0
    s.cooldownUntilMs = 0
    s.lastStatus = status
    s.lastError = null
    s.lastSuccessAt = new Date(this.now()).toISOString()
  }

  /** Record a non-failover client error (e.g. HTTP 400) without cooling down the provider. */
  recordPassthroughError(providerId: string, status: number): void {
    const s = this.statsFor(providerId)
    s.requests++
    s.lastStatus = status
  }

  /** Put a provider into cooldown after a 429 / 5xx / transport failure. Returns applied cooldown ms. */
  recordFailoverFailure(
    providerId: string,
    opts: { readonly status: number | null; readonly reason: string; readonly retryAfterHeader?: string | null },
  ): number {
    const nowMs = this.now()
    const s = this.statsFor(providerId)
    s.requests++
    s.failovers++
    s.consecutiveFailures++
    s.lastStatus = opts.status
    s.lastError = scrubSecretText(opts.reason).slice(0, 240)

    const retryMs = parseRetryAfterMs(opts.retryAfterHeader, nowMs)
    const expMs = Math.min(
      this.config.maxCooldownMs,
      this.config.cooldownMs * 2 ** Math.max(0, s.consecutiveFailures - 1),
    )
    const cooldownMs =
      retryMs !== null ? Math.max(this.config.cooldownMs, Math.min(this.config.maxCooldownMs, retryMs)) : expMs
    s.cooldownUntilMs = nowMs + cooldownMs
    return cooldownMs
  }

  /** Clear cooldown state for one provider, or all providers when omitted. Returns count reset. */
  resetCooldown(providerId?: string): number {
    if (providerId !== undefined) {
      const s = this.stats.get(providerId)
      if (!s) return 0
      s.cooldownUntilMs = 0
      s.consecutiveFailures = 0
      return 1
    }
    let count = 0
    for (const s of this.stats.values()) {
      if (s.cooldownUntilMs > 0 || s.consecutiveFailures > 0) count++
      s.cooldownUntilMs = 0
      s.consecutiveFailures = 0
    }
    return count
  }

  providerStatuses(): readonly GatewayProviderRuntimeStatus[] {
    const nowMs = this.now()
    return [...this.config.providers]
      .map((provider, index) => ({ provider, index }))
      .sort((a, b) => a.provider.priority - b.provider.priority || a.index - b.index)
      .map(({ provider }) => {
        const s = this.stats.get(provider.id)
        const inCooldown = Boolean(s && s.cooldownUntilMs > nowMs)
        return {
          id: provider.id,
          protocol: provider.protocol,
          baseUrl: provider.baseUrl,
          priority: provider.priority,
          models: provider.models,
          enabled: provider.enabled,
          keySource: describeProviderKeySource(provider, this.credentialDeps),
          apiKeyEnv: effectiveProviderKeyEnv(provider),
          inCooldown,
          cooldownUntil: inCooldown && s ? new Date(s.cooldownUntilMs).toISOString() : null,
          consecutiveFailures: s?.consecutiveFailures ?? 0,
          lastStatus: s?.lastStatus ?? null,
          lastError: s?.lastError ?? null,
          lastSuccessAt: s?.lastSuccessAt ?? null,
          requests: s?.requests ?? 0,
          failovers: s?.failovers ?? 0,
        }
      })
  }
}
