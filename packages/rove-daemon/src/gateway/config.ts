/**
 * Config parsing & validation for `state.json["providerGateway"]`.
 *
 * Opt-in and disabled by default. Rejects non-loopback bind hosts, non-HTTPS
 * remote upstream URLs, and plaintext credentials inside `state.json`.
 */

import type {
  GatewayBindHost,
  GatewayInjectMode,
  GatewayProviderConfig,
  GatewayProviderProtocol,
  ProviderGatewayConfig,
} from "./types.ts"

export const DEFAULT_GATEWAY_HOST: GatewayBindHost = "127.0.0.1"
export const DEFAULT_GATEWAY_PORT = 0
export const DEFAULT_GATEWAY_COOLDOWN_MS = 60_000
export const DEFAULT_GATEWAY_MAX_COOLDOWN_MS = 300_000
export const DEFAULT_GATEWAY_TIMEOUT_MS = 120_000

const MIN_COOLDOWN_MS = 1_000
const MAX_COOLDOWN_MS = 3_600_000
const MIN_TIMEOUT_MS = 1_000
const MAX_TIMEOUT_MS = 600_000

const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/
const ENV_VAR_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const FORBIDDEN_CONFIG_KEY_NAMES = new Set(["apikey", "api_key", "secret", "token", "password", "auth"])
const FORBIDDEN_HEADER_NAMES = new Set(["authorization", "x-api-key", "api-key", "proxy-authorization"])

export const DEFAULT_PROVIDER_GATEWAY_CONFIG: ProviderGatewayConfig = {
  enabled: false,
  host: DEFAULT_GATEWAY_HOST,
  port: DEFAULT_GATEWAY_PORT,
  injectMode: "headless",
  cooldownMs: DEFAULT_GATEWAY_COOLDOWN_MS,
  maxCooldownMs: DEFAULT_GATEWAY_MAX_COOLDOWN_MS,
  requestTimeoutMs: DEFAULT_GATEWAY_TIMEOUT_MS,
  providers: [],
}

export interface ParsedGatewayConfig {
  readonly config: ProviderGatewayConfig
  readonly warnings: readonly string[]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

/** Loopback hosts allowed for plain `http://` upstreams (matches auto-routing classifier policy). */
export function isLoopbackHostname(hostname: string): boolean {
  const bare = hostname.toLowerCase().replace(/^\[|\]$/g, "")
  return bare === "127.0.0.1" || bare === "::1" || bare === "localhost"
}

/** Validate an upstream provider baseUrl: https anywhere, http only on loopback. */
export function validateProviderBaseUrl(raw: string): { ok: true; url: string } | { ok: false; error: string } {
  const trimmed = raw.trim()
  if (!trimmed) return { ok: false, error: "baseUrl is required" }
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return { ok: false, error: `baseUrl is not a valid URL: "${trimmed}"` }
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: "baseUrl must not contain embedded credentials" }
  }
  if (parsed.protocol === "https:") {
    return { ok: true, url: trimmed.replace(/\/+$/, "") }
  }
  if (parsed.protocol === "http:") {
    if (!isLoopbackHostname(parsed.hostname)) {
      return {
        ok: false,
        error: `plain http:// baseUrl is only permitted for loopback hosts (got "${parsed.hostname}")`,
      }
    }
    return { ok: true, url: trimmed.replace(/\/+$/, "") }
  }
  return { ok: false, error: `baseUrl must use https:// (or http:// on loopback), got "${parsed.protocol}"` }
}

/** Strictly literal loopback IP for binding the local HTTP server. */
export function validateBindHost(raw: unknown): GatewayBindHost | null {
  if (raw === "127.0.0.1" || raw === "::1") return raw
  return null
}

export function validateProviderId(raw: string): boolean {
  return PROVIDER_ID_PATTERN.test(raw)
}

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback
  const rounded = Math.round(raw)
  return Math.max(min, Math.min(max, rounded))
}

function parseProviderEntry(
  raw: unknown,
  index: number,
  seenIds: Set<string>,
  warnings: string[],
): GatewayProviderConfig | null {
  if (!isPlainObject(raw)) {
    warnings.push(`providerGateway.providers[${index}] must be an object`)
    return null
  }
  // Refuse plaintext secrets in state.json so keys never sit on disk unencrypted.
  for (const key of Object.keys(raw)) {
    if (FORBIDDEN_CONFIG_KEY_NAMES.has(key.toLowerCase())) {
      warnings.push(
        `providerGateway.providers[${index}] contains forbidden credential field "${key}" — store keys in OS Keychain or use apiKeyEnv`,
      )
      return null
    }
  }
  const id = typeof raw.id === "string" ? raw.id.trim() : ""
  if (!validateProviderId(id)) {
    warnings.push(`providerGateway.providers[${index}] has invalid id "${id}" (use lowercase letters, digits, -, _)`)
    return null
  }
  if (seenIds.has(id)) {
    warnings.push(`providerGateway.providers[${index}] duplicates provider id "${id}"`)
    return null
  }
  const protocol = raw.protocol
  if (protocol !== "anthropic" && protocol !== "openai") {
    warnings.push(`provider "${id}" has invalid protocol "${String(protocol)}" (expected "anthropic" or "openai")`)
    return null
  }
  const urlCheck =
    typeof raw.baseUrl === "string"
      ? validateProviderBaseUrl(raw.baseUrl)
      : { ok: false as const, error: "baseUrl is required" }
  if (!urlCheck.ok) {
    warnings.push(`provider "${id}": ${urlCheck.error}`)
    return null
  }
  const rawModels = Array.isArray(raw.models)
    ? raw.models.filter((m): m is string => typeof m === "string" && m.trim().length > 0).map((m) => m.trim())
    : []
  if (rawModels.length === 0) {
    warnings.push(`provider "${id}" must list at least one model (or "*")`)
    return null
  }
  const priority = typeof raw.priority === "number" && Number.isFinite(raw.priority) ? Math.round(raw.priority) : 100
  const enabled = typeof raw.enabled === "boolean" ? raw.enabled : true

  let modelMap: Record<string, string> | undefined
  if (isPlainObject(raw.modelMap)) {
    modelMap = {}
    for (const [from, to] of Object.entries(raw.modelMap)) {
      if (typeof to === "string" && from.trim() && to.trim()) {
        modelMap[from.trim()] = to.trim()
      }
    }
    if (Object.keys(modelMap).length === 0) modelMap = undefined
  }

  let extraHeaders: Record<string, string> | undefined
  if (isPlainObject(raw.extraHeaders)) {
    extraHeaders = {}
    for (const [name, value] of Object.entries(raw.extraHeaders)) {
      if (typeof value !== "string" || !name.trim()) continue
      if (FORBIDDEN_HEADER_NAMES.has(name.trim().toLowerCase())) {
        warnings.push(`provider "${id}" ignored forbidden auth header "${name}" in extraHeaders`)
        continue
      }
      extraHeaders[name.trim()] = value
    }
    if (Object.keys(extraHeaders).length === 0) extraHeaders = undefined
  }

  let apiKeyEnv: string | undefined
  if (typeof raw.apiKeyEnv === "string" && raw.apiKeyEnv.trim()) {
    const candidate = raw.apiKeyEnv.trim()
    if (ENV_VAR_PATTERN.test(candidate)) apiKeyEnv = candidate
    else warnings.push(`provider "${id}" ignored invalid apiKeyEnv "${candidate}"`)
  }

  const keychainAccount =
    typeof raw.keychainAccount === "string" && raw.keychainAccount.trim() ? raw.keychainAccount.trim() : undefined

  seenIds.add(id)
  return {
    id,
    protocol: protocol as GatewayProviderProtocol,
    baseUrl: urlCheck.url,
    priority,
    models: rawModels,
    ...(modelMap ? { modelMap } : {}),
    ...(keychainAccount ? { keychainAccount } : {}),
    ...(apiKeyEnv ? { apiKeyEnv } : {}),
    enabled,
    ...(extraHeaders ? { extraHeaders } : {}),
  }
}

/**
 * Tolerant parser for runtime boot: bad fields warn and fall back to safe
 * defaults (matching `docs/CONFIGURATION.md` hand-editing safety).
 */
export function parseProviderGatewayConfig(raw: unknown): ParsedGatewayConfig {
  if (raw === undefined || raw === null) {
    return { config: DEFAULT_PROVIDER_GATEWAY_CONFIG, warnings: [] }
  }
  const warnings: string[] = []
  if (!isPlainObject(raw)) {
    warnings.push("providerGateway must be an object; falling back to disabled")
    return { config: DEFAULT_PROVIDER_GATEWAY_CONFIG, warnings }
  }

  const enabled = typeof raw.enabled === "boolean" ? raw.enabled : false
  let host: GatewayBindHost = DEFAULT_GATEWAY_HOST
  if (raw.host !== undefined) {
    const validHost = validateBindHost(raw.host)
    if (validHost) host = validHost
    else {
      warnings.push(
        `providerGateway.host "${String(raw.host)}" is not a literal loopback IP ("127.0.0.1" or "::1"); forcing "127.0.0.1"`,
      )
    }
  }

  let port = DEFAULT_GATEWAY_PORT
  if (raw.port !== undefined) {
    if (typeof raw.port === "number" && Number.isInteger(raw.port) && raw.port >= 0 && raw.port <= 65535) {
      port = raw.port
    } else {
      warnings.push(`providerGateway.port "${String(raw.port)}" must be an integer 0..65535; using 0 (ephemeral)`)
    }
  }

  let injectMode: GatewayInjectMode = "headless"
  if (raw.injectMode !== undefined) {
    if (raw.injectMode === "headless" || raw.injectMode === "off") {
      injectMode = raw.injectMode
    } else {
      warnings.push(
        `providerGateway.injectMode "${String(raw.injectMode)}" must be "headless" or "off"; using "headless"`,
      )
    }
  }

  const cooldownMs = clampInt(raw.cooldownMs, DEFAULT_GATEWAY_COOLDOWN_MS, MIN_COOLDOWN_MS, MAX_COOLDOWN_MS)
  const maxCooldownMs = Math.max(
    cooldownMs,
    clampInt(raw.maxCooldownMs, DEFAULT_GATEWAY_MAX_COOLDOWN_MS, MIN_COOLDOWN_MS, MAX_COOLDOWN_MS),
  )
  const requestTimeoutMs = clampInt(raw.requestTimeoutMs, DEFAULT_GATEWAY_TIMEOUT_MS, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS)

  const providers: GatewayProviderConfig[] = []
  const seenIds = new Set<string>()
  if (Array.isArray(raw.providers)) {
    for (let i = 0; i < raw.providers.length; i++) {
      const entry = parseProviderEntry(raw.providers[i], i, seenIds, warnings)
      if (entry) providers.push(entry)
    }
  } else if (raw.providers !== undefined) {
    warnings.push("providerGateway.providers must be an array")
  }

  return {
    config: {
      enabled,
      host,
      port,
      injectMode,
      cooldownMs,
      maxCooldownMs,
      requestTimeoutMs,
      providers,
    },
    warnings,
  }
}

/**
 * Strict validation for CLI writes (`rove gateway add` / `enable`): returns
 * errors instead of silently ignoring typos.
 */
export function validateProviderInput(input: {
  readonly id: string
  readonly protocol: string
  readonly baseUrl: string
  readonly models: readonly string[]
  readonly priority?: number
  readonly apiKeyEnv?: string
  readonly modelMap?: Readonly<Record<string, string>>
}): { ok: true; provider: GatewayProviderConfig } | { ok: false; error: string } {
  const id = input.id.trim()
  if (!validateProviderId(id)) {
    return { ok: false, error: `invalid provider id "${id}" — use lowercase letters, digits, "-" and "_"` }
  }
  if (input.protocol !== "anthropic" && input.protocol !== "openai") {
    return { ok: false, error: `invalid protocol "${input.protocol}" — expected "anthropic" or "openai"` }
  }
  const urlCheck = validateProviderBaseUrl(input.baseUrl)
  if (!urlCheck.ok) return { ok: false, error: urlCheck.error }
  const models = input.models.map((m) => m.trim()).filter(Boolean)
  if (models.length === 0) return { ok: false, error: 'at least one model pattern is required (or "*")' }
  const priority = input.priority === undefined ? 100 : Math.round(input.priority)
  if (!Number.isFinite(priority)) return { ok: false, error: "priority must be a finite integer" }
  const apiKeyEnv = input.apiKeyEnv?.trim() || undefined
  if (apiKeyEnv && !ENV_VAR_PATTERN.test(apiKeyEnv)) {
    return { ok: false, error: `invalid apiKeyEnv "${apiKeyEnv}" — expected an environment variable name` }
  }
  const modelMap = input.modelMap && Object.keys(input.modelMap).length > 0 ? { ...input.modelMap } : undefined

  return {
    ok: true,
    provider: {
      id,
      protocol: input.protocol,
      baseUrl: urlCheck.url,
      priority,
      models,
      ...(modelMap ? { modelMap } : {}),
      ...(apiKeyEnv ? { apiKeyEnv } : {}),
      enabled: true,
    },
  }
}
